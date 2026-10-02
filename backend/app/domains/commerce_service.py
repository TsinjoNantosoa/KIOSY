import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.serializers import iso, money, offer_out, order_out
from app.core.config import Settings
from app.core.errors import DomainError
from app.core.security import utcnow
from app.db.models import (
    DurableTask,
    Entitlement,
    Offer,
    Order,
    OrderStatus,
    OutboxEvent,
    PaymentAttempt,
    Quote,
    Reservation,
    Subscription,
    TaskStatus,
    User,
)
from app.domains.catalog_service import get_latest_offer


def eligibility(db: Session, user: User | None, offer: Offer) -> dict[str, Any]:
    if offer.status != "active":
        reason = "OFFER_SOLD_OUT" if offer.status == "sold_out" else "OFFER_UNAVAILABLE"
        return {"offer_id": offer.offer_key, "can_purchase": False, "already_owned": False, "blocking_reason": reason, "overlaps": [], "pending_order_id": None}
    if not user:
        return {"offer_id": offer.offer_key, "can_purchase": False, "already_owned": False, "blocking_reason": "AUTH_REQUIRED", "overlaps": [], "pending_order_id": None}
    pending = db.scalar(select(Order).where(Order.user_id == user.id, Order.offer_id == offer.id, Order.status.in_([OrderStatus.created, OrderStatus.pending_payment])))
    if pending:
        return {"offer_id": offer.offer_key, "can_purchase": False, "already_owned": False, "blocking_reason": "PENDING_ORDER", "overlaps": [], "pending_order_id": pending.id}
    entitlements = list(db.scalars(select(Entitlement).where(Entitlement.user_id == user.id, Entitlement.status == "active")))
    overlaps = []
    for item in entitlements:
        same_edition = offer.scope.get("edition_id") and item.scope.get("edition_id") == offer.scope.get("edition_id")
        same_collection = offer.scope.get("universe") and item.scope.get("universe") == offer.scope.get("universe")
        if same_edition or same_collection:
            overlaps.append({"entitlement_id": item.id, "description": "Ce droit couvre déjà tout ou partie de l'offre."})
    already_owned = any(item.scope == offer.scope for item in entitlements)
    return {"offer_id": offer.offer_key, "can_purchase": not already_owned, "already_owned": already_owned, "blocking_reason": "ALREADY_OWNED" if already_owned else None, "overlaps": overlaps, "pending_order_id": None}


def access_end(offer: Offer):
    if not offer.duration:
        return None
    count = int(offer.duration["count"])
    unit = offer.duration["unit"]
    days = count if unit == "day" else count * 30 if unit == "month" else count * 365
    return utcnow() + timedelta(days=days)


def quote(db: Session, user: User | None, offer_id: str, renewal_id: str | None, settings: Settings) -> dict[str, Any]:
    offer = get_latest_offer(db, offer_id)
    eligible = eligibility(db, user, offer)
    now = utcnow()
    snapshot = offer_out(offer)
    row = Quote(
        user_id=user.id if user else None,
        offer_id=offer.id,
        snapshot=snapshot,
        total_amount=offer.price_amount,
        currency=offer.price_currency,
        scale=offer.price_scale,
        renewal_of_subscription_id=renewal_id,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.quote_ttl_minutes),
    )
    db.add(row)
    db.commit()
    amount = money(offer.price_amount, offer.price_currency, offer.price_scale)
    return {"quote_id": row.id, "offer": snapshot, "lines": [{"label": offer.title, "amount": amount}], "total": amount, "access_starts_at": iso(now), "access_ends_at": iso(access_end(offer)), "eligibility": eligible, "renewal_of_subscription_id": renewal_id, "quote_expires_at": iso(row.expires_at)}


def snapshot_offer(offer: Offer) -> dict[str, Any]:
    return {
        "offer_id": offer.offer_key,
        "offer_version": offer.version,
        "title": offer.title,
        "kind": offer.kind.value,
        "price": money(offer.price_amount, offer.price_currency, offer.price_scale),
        "duration": offer.duration,
        "renewal": offer.renewal,
        "scope_label": str(offer.scope.get("label", offer.title)),
        "scope": offer.scope,
        "conditions_version": offer.conditions_version,
    }


def create_order(db: Session, user: User, payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    offer = get_latest_offer(db, payload["offer_id"], lock=True)
    quote_row = db.scalar(select(Quote).where(Quote.id == payload["quote_id"], Quote.user_id == user.id).with_for_update())
    if not quote_row:
        raise DomainError(404, "QUOTE_NOT_FOUND", "Le devis est introuvable.")
    if quote_row.expires_at <= utcnow():
        raise DomainError(409, "QUOTE_EXPIRED", "Le devis a expiré; demandez un nouveau calcul.")
    if quote_row.offer_id != offer.id or quote_row.total_amount != offer.price_amount or quote_row.currency != offer.price_currency or quote_row.scale != offer.price_scale:
        raise DomainError(409, "OFFER_CHANGED", "Le prix ou la devise de l'offre a changé.")
    if offer.version != payload["offer_version"] or offer.conditions_version != payload["accepted_conditions_version"]:
        raise DomainError(409, "OFFER_CHANGED", "L'offre ou ses conditions ont changé.")
    current_eligibility = eligibility(db, user, offer)
    if not current_eligibility["can_purchase"]:
        raise DomainError(409, current_eligibility["blocking_reason"] or "OFFER_UNAVAILABLE", "Cette offre ne peut plus être commandée.")
    if offer.quota_remaining is not None:
        if offer.quota_remaining <= 0:
            raise DomainError(409, "OFFER_SOLD_OUT", "Le quota de cette offre est épuisé.")
        offer.quota_remaining -= 1
    now = utcnow()
    scope = offer.scope
    order = Order(
        reference=f"KIO-{now:%Y%m%d}-{secrets.token_hex(3).upper()}",
        user_id=user.id,
        offer_id=offer.id,
        offer_snapshot=snapshot_offer(offer),
        accepted_conditions_version=payload["accepted_conditions_version"],
        status=OrderStatus.created,
        total_amount=offer.price_amount,
        currency=offer.price_currency,
        scale=offer.price_scale,
        edition_id=scope.get("edition_id"),
        renewal_of_subscription_id=payload.get("renewal_of_subscription_id"),
    )
    db.add(order)
    db.flush()
    reservation = None
    if offer.quota_total is not None:
        reservation = Reservation(order_id=order.id, offer_id=offer.id, status="reserved", expires_at=now + timedelta(minutes=settings.reservation_ttl_minutes))
        db.add(reservation)
    if offer.price_amount == 0:
        fulfill_order(db, order, None)
    db.flush()
    return order_out(order, None, reservation)


def fulfill_order(db: Session, order: Order, payment: PaymentAttempt | None) -> None:
    if order.status == OrderStatus.fulfilled:
        return
    now = utcnow()
    snapshot = order.offer_snapshot
    reservation = db.get(Reservation, order.id)
    if reservation and reservation.status != "reserved":
        order.status = OrderStatus.payment_exception
        order.exception_reason = "Paiement confirmé après libération de la réservation. Réconciliation requise."
        return
    if reservation:
        reservation.status = "consumed"
    order.status = OrderStatus.fulfilled
    scope = snapshot.get("scope") or ({"kind": "edition", "edition_id": order.edition_id} if order.edition_id else {})
    valid_until = None
    duration = snapshot.get("duration")
    if duration:
        count = int(duration["count"])
        days = count if duration["unit"] == "day" else count * 30 if duration["unit"] == "month" else count * 365
        valid_until = now + timedelta(days=days)
    entitlement = Entitlement(user_id=order.user_id, source="subscription" if snapshot["kind"] == "subscription" else "purchase", source_ref=order.id, scope=scope, valid_from=now, valid_until=valid_until, status="active")
    db.add(entitlement)
    if snapshot["kind"] == "subscription":
        subscription = Subscription(user_id=order.user_id, order_id=order.id, offer_snapshot=snapshot, universe=scope.get("universe", "presse"), status="active", current_period_start=now, current_period_end=valid_until or now + timedelta(days=30), history=[{"at": iso(now), "label": "Abonnement activé"}])
        db.add(subscription)
        db.flush()
        order.subscription_id = subscription.id
    db.add(OutboxEvent(topic="order.fulfilled", aggregate_id=order.id, payload={"order_id": order.id}, created_at=now))


def checkout(db: Session, user: User, order_id: str, settings: Settings) -> dict[str, Any]:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.user_id == user.id).with_for_update())
    if not order:
        raise DomainError(404, "NOT_FOUND", "Commande introuvable.")
    if order.status == OrderStatus.fulfilled:
        raise DomainError(409, "ORDER_ALREADY_FULFILLED", "Cette commande est déjà exécutée.")
    active = db.scalar(select(PaymentAttempt).where(PaymentAttempt.order_id == order.id, PaymentAttempt.status.in_(["initiated", "pending"])).order_by(PaymentAttempt.created_at.desc()))
    if active:
        raise DomainError(409, "PAYMENT_PENDING", "Un paiement est déjà en cours.")
    reservation = db.get(Reservation, order.id)
    if reservation and reservation.expires_at <= utcnow():
        reservation.status = "expired"
        offer = db.scalar(select(Offer).where(Offer.id == reservation.offer_id).with_for_update())
        if offer and offer.quota_remaining is not None:
            offer.quota_remaining = min(offer.quota_total or offer.quota_remaining + 1, offer.quota_remaining + 1)
        order.status = OrderStatus.cancelled
        db.commit()
        raise DomainError(409, "RESERVATION_EXPIRED", "La réservation a expiré.")
    if not settings.test_payment_enabled:
        raise DomainError(503, "PAYMENT_PROVIDER_UNAVAILABLE", "Aucun prestataire de paiement n'est configuré.")
    provider_session_id = secrets.token_urlsafe(24)
    attempt = PaymentAttempt(order_id=order.id, provider="kiosy-test", provider_session_id=provider_session_id, mode="test", status="initiated", expected_amount=order.total_amount, currency=order.currency, scale=order.scale)
    db.add(attempt)
    order.status = OrderStatus.pending_payment
    db.flush()
    return {"session_id": provider_session_id, "order_id": order.id, "redirect_url": f"{settings.public_api_url}/v1/test-payments/{provider_session_id}", "expires_at": iso(utcnow() + timedelta(minutes=20)), "mode": "test"}


def enqueue(db: Session, kind: str, payload: dict[str, Any]) -> DurableTask:
    task = DurableTask(kind=kind, payload=payload, status=TaskStatus.queued, available_at=utcnow())
    db.add(task)
    db.flush()
    return task
