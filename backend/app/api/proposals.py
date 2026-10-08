import hashlib
import json
from datetime import timedelta

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.serializers import iso, offer_out
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import current_user, utcnow
from app.db.base import get_db
from app.db.models import Proposal, Quote, Run, Subscription, User
from app.domains.audit import record_audit
from app.domains.catalog_service import get_latest_offer
from app.domains.commerce_service import create_order, eligibility, enqueue
from app.domains.idempotency import begin, complete

router = APIRouter(prefix="/v1")


def proposal_out(row: Proposal) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "status": row.status,
        "title": row.title,
        "resource": row.resource,
        "consequences": row.consequences,
        "amount": row.amount,
        "conditions_version": row.conditions_version,
        "expires_at": iso(row.expires_at),
        "approval": row.approval,
        "origin": row.origin,
        "created_at": iso(row.created_at),
        "result": row.result,
    }


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.actor_id == user.id))
    if not row:
        raise DomainError(404, "NOT_FOUND", "Proposition introuvable.")
    return proposal_out(row)


@router.post("/subscriptions/{subscription_id}/cancellation-proposals", status_code=201)
def prepare_cancellation(
    subscription_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    subscription = db.scalar(
        select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id)
    )
    if not subscription:
        raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
    row = Proposal(
        actor_id=user.id,
        type="cancel_subscription",
        status="pending",
        title="Résilier à la fin de la période",
        resource={
            "type": "subscription",
            "id": subscription.id,
            "label": subscription.offer_snapshot["title"],
            "version": 1,
        },
        parameters={},
        consequences=[
            f"Accès maintenu jusqu'au {iso(subscription.current_period_end)}.",
            "Aucun renouvellement automatique.",
        ],
        expires_at=utcnow() + timedelta(minutes=15),
        approval="self",
        origin="form",
    )
    db.add(row)
    db.flush()
    record_audit(
        db,
        action="proposal.created",
        target_type="proposal",
        target_id=row.id,
        result="success",
        request_id="api",
        actor=user,
        metadata={"type": row.type},
    )
    db.commit()
    return proposal_out(row)


@router.post("/subscriptions/{subscription_id}/plan-change-proposals", status_code=201)
def prepare_change(
    subscription_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    if set(payload) != {"target_offer_id"}:
        raise DomainError(422, "INVALID_BODY", "Corps invalide.")
    subscription = db.scalar(
        select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id)
    )
    if not subscription:
        raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
    row = Proposal(
        actor_id=user.id,
        type="change_plan",
        status="pending",
        title="Changer de formule à l'échéance",
        resource={
            "type": "subscription",
            "id": subscription.id,
            "label": subscription.offer_snapshot["title"],
            "version": 1,
        },
        parameters={"target_offer_id": payload["target_offer_id"]},
        consequences=["Le changement prend effet à la prochaine échéance.", "Aucun prorata n'est appliqué."],
        expires_at=utcnow() + timedelta(minutes=15),
        approval="self",
        origin="form",
    )
    db.add(row)
    db.commit()
    return proposal_out(row)


def decide(
    proposal_id: str, decision: str, key: str | None, db: Session, user: User, settings: Settings
) -> dict:
    row = db.scalar(
        select(Proposal).where(Proposal.id == proposal_id, Proposal.actor_id == user.id).with_for_update()
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Proposition introuvable.")
    operation, replay = begin(db, user.id, f"proposal_{decision}", key, {"proposal_id": proposal_id})
    if replay is not None:
        return replay
    if (decision == "confirm" and row.status == "confirmed") or (
        decision == "reject" and row.status == "rejected"
    ):
        result = proposal_out(row)
        complete(operation, result, 200, "proposal", row.id)
        db.commit()
        return result
    if row.status != "pending":
        raise DomainError(409, "PROPOSAL_ALREADY_DECIDED", "Cette proposition a déjà été traitée.")
    if row.expires_at <= utcnow():
        row.status = "expired"
        db.delete(operation)
        db.commit()
        raise DomainError(409, "PROPOSAL_EXPIRED", "Cette proposition a expiré.")
    if decision == "reject":
        row.status = "rejected"
        row.result = {"summary": "Proposition refusée.", "links": []}
    elif row.type == "purchase":
        normalized = {
            "offer_id": row.parameters.get("offer_id"),
            "offer_version": row.parameters.get("offer_version"),
        }
        fingerprint = hashlib.sha256(
            json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        if row.parameters.get("fingerprint") != fingerprint:
            raise DomainError(409, "PROPOSAL_STALE", "L'empreinte de la proposition est invalide.")
        offer = get_latest_offer(db, str(normalized["offer_id"]), lock=True)
        expected_price = row.amount or {}
        if (
            offer.version != normalized["offer_version"]
            or offer.version != row.resource.get("version")
            or offer.price_amount != expected_price.get("amount")
            or offer.price_currency != expected_price.get("currency")
            or offer.price_scale != expected_price.get("scale")
            or offer.conditions_version != row.conditions_version
            or row.parameters.get("currency") != offer.price_currency
        ):
            raise DomainError(
                409, "PROPOSAL_STALE", "Le prix, la devise, la version ou les conditions ont changé."
            )
        facts = eligibility(db, user, offer)
        if not facts["can_purchase"]:
            raise DomainError(
                409, facts.get("blocking_reason") or "PROPOSAL_STALE", "L'offre n'est plus achetable."
            )
        now = utcnow()
        snapshot = offer_out(offer)
        quote = Quote(
            user_id=user.id,
            offer_id=offer.id,
            snapshot=snapshot,
            total_amount=offer.price_amount,
            currency=offer.price_currency,
            scale=offer.price_scale,
            renewal_of_subscription_id=None,
            created_at=now,
            expires_at=now + timedelta(minutes=settings.quote_ttl_minutes),
        )
        db.add(quote)
        db.flush()
        order = create_order(
            db,
            user,
            {
                "quote_id": quote.id,
                "offer_id": offer.offer_key,
                "offer_version": offer.version,
                "renewal_of_subscription_id": None,
                "accepted_conditions_version": offer.conditions_version,
            },
            settings,
        )
        row.status = "confirmed"
        row.result = {
            "summary": "Commande créée après confirmation. Aucun paiement n'a encore été débité.",
            "links": [{"label": "Continuer vers le paiement", "to": f"/commande/{order['id']}"}],
        }
    elif row.type == "cancel_subscription":
        subscription = db.scalar(
            select(Subscription)
            .where(Subscription.id == row.resource["id"], Subscription.user_id == user.id)
            .with_for_update()
        )
        if not subscription or subscription.status != "active":
            raise DomainError(409, "PROPOSAL_STALE", "L'abonnement a changé depuis la préparation.")
        subscription.cancel_at_period_end = True
        subscription.history = [
            *subscription.history,
            {"at": iso(utcnow()), "label": "Résiliation programmée"},
        ]
        row.status = "confirmed"
        row.result = {
            "summary": "Résiliation programmée à l'échéance.",
            "links": [{"label": "Voir l'abonnement", "to": f"/compte/abonnements/{subscription.id}"}],
        }
    elif row.type == "change_plan":
        subscription = db.scalar(
            select(Subscription)
            .where(Subscription.id == row.resource["id"], Subscription.user_id == user.id)
            .with_for_update()
        )
        if not subscription or subscription.status != "active":
            raise DomainError(409, "PROPOSAL_STALE", "L'abonnement a changé depuis la préparation.")
        subscription.scheduled_change = {
            "target_offer_title": row.parameters["target_offer_id"],
            "effective_at": iso(subscription.current_period_end),
        }
        row.status = "confirmed"
        row.result = {
            "summary": "Changement programmé.",
            "links": [{"label": "Voir l'abonnement", "to": f"/compte/abonnements/{subscription.id}"}],
        }
    else:
        raise DomainError(409, "PROPOSAL_STALE", "Cette action n'est pas disponible.")
    record_audit(
        db,
        action=f"proposal.{decision}",
        target_type="proposal",
        target_id=row.id,
        result=row.status,
        request_id="api",
        actor=user,
        metadata={"type": row.type},
    )
    result = proposal_out(row)
    run_id = row.parameters.get("_run_id") if isinstance(row.parameters, dict) else None
    if run_id:
        run = db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user.id).with_for_update())
        if run and run.status == "waiting_approval":
            run.status = "queued"
            from app.api.assistant import append_event

            append_event(db, run, "status", {"status": "queued"})
            enqueue(
                db,
                "assistant_resume",
                {
                    "run_id": run.id,
                    "resume": {
                        "decision": row.status,
                        "proposal_id": row.id,
                        "summary": row.result["summary"] if row.result else "Proposition traitée.",
                    },
                },
            )
    complete(operation, result, 200, "proposal", row.id)
    db.commit()
    return result


@router.post("/proposals/{proposal_id}/confirm")
def confirm(
    proposal_id: str,
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    return decide(proposal_id, "confirm", idempotency_key, db, user, settings)


@router.post("/proposals/{proposal_id}/reject")
def reject(
    proposal_id: str,
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    return decide(proposal_id, "reject", idempotency_key, db, user, settings)
