from datetime import UTC, datetime
from typing import Any

from app.db.models import (
    Edition,
    Offer,
    Order,
    PaymentAttempt,
    Publication,
    Publisher,
    Reservation,
    SessionRecord,
    User,
)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def money(amount: int, currency: str, scale: int) -> dict[str, Any]:
    return {"amount": amount, "currency": currency, "scale": scale}


def publisher_out(item: Publisher) -> dict[str, Any]:
    return {"id": item.id, "name": item.name, "is_demo": item.is_demo}


def user_out(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "roles": [role for role in user.roles if role != "service"],
        "publisher_id": user.publisher_id,
        "preferences": user.preferences,
        "is_demo": user.is_demo,
    }


def session_out(record: SessionRecord, user: User) -> dict[str, Any]:
    return {"user": user_out(user), "expires_at": iso(record.expires_at)}


def publication_out(item: Publication, publisher: Publisher) -> dict[str, Any]:
    return {
        "id": item.id,
        "slug": item.slug,
        "title": item.title,
        "author": item.author,
        "publisher": publisher_out(publisher),
        "universe": item.universe,
        "language": item.language,
        "summary": item.summary,
        "tags": item.tags,
        "cover": item.cover,
        "kind": item.kind,
        "is_demo": item.is_demo,
    }


def edition_out(item: Edition) -> dict[str, Any]:
    return {
        "id": item.id,
        "publication_id": item.publication_id,
        "label": item.label,
        "published_at": iso(item.published_at),
        "format": item.format,
        "language": item.language,
        "page_count": item.page_count,
        "word_count": item.word_count,
        "status": item.status.value,
        "availability": item.availability,
        "permissions": item.permissions,
        "is_free": item.is_free,
        "version": item.version,
        "asset_id": item.asset_id,
    }


def offer_out(item: Offer) -> dict[str, Any]:
    quota = None
    if item.quota_total is not None:
        quota = {"total": item.quota_total, "remaining": item.quota_remaining or 0}
    return {
        "id": item.offer_key,
        "version": item.version,
        "kind": item.kind.value,
        "title": item.title,
        "description": item.description,
        "price": money(item.price_amount, item.price_currency, item.price_scale),
        "duration": item.duration,
        "renewal": item.renewal,
        "scope": item.scope,
        "restrictions": item.restrictions,
        "conditions_version": item.conditions_version,
        "status": item.status,
        "status_reason": item.status_reason,
        "quota": quota,
        "is_demo": item.is_demo,
    }


def order_out(
    order: Order, payment: PaymentAttempt | None, reservation: Reservation | None
) -> dict[str, Any]:
    snapshot = order.offer_snapshot
    amount = money(order.total_amount, order.currency, order.scale)
    payment_out = None
    if payment:
        payment_out = {
            "status": payment.status,
            "provider": payment.provider,
            "mode": payment.mode,
            "updated_at": iso(payment.updated_at),
        }
    reservation_out = None
    if reservation:
        reservation_out = {"status": reservation.status, "expires_at": iso(reservation.expires_at)}
    return {
        "id": order.id,
        "reference": order.reference,
        "status": order.status.value,
        "lines": [{"label": snapshot["title"], "snapshot": snapshot, "amount": amount}],
        "total": amount,
        "created_at": iso(order.created_at),
        "updated_at": iso(order.updated_at),
        "payment": payment_out,
        "reservation": reservation_out,
        "subscription_id": order.subscription_id,
        "edition_id": order.edition_id,
        "renewal_of_subscription_id": order.renewal_of_subscription_id,
        "receipt_available": order.receipt_available,
        "exception_reason": order.exception_reason,
        "is_demo": False,
    }
