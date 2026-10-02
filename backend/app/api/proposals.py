from datetime import timedelta

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.core.errors import DomainError
from app.core.security import current_user, utcnow
from app.db.base import get_db
from app.db.models import Proposal, Subscription, User
from app.domains.audit import record_audit
from app.domains.idempotency import begin, complete

router = APIRouter(prefix="/v1")


def proposal_out(row: Proposal) -> dict:
    return {"id": row.id, "type": row.type, "status": row.status, "title": row.title, "resource": row.resource, "consequences": row.consequences, "amount": row.amount, "conditions_version": row.conditions_version, "expires_at": iso(row.expires_at), "approval": row.approval, "origin": row.origin, "created_at": iso(row.created_at), "result": row.result}


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.actor_id == user.id))
    if not row:
        raise DomainError(404, "NOT_FOUND", "Proposition introuvable.")
    return proposal_out(row)


@router.post("/subscriptions/{subscription_id}/cancellation-proposals", status_code=201)
def prepare_cancellation(subscription_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    subscription = db.scalar(select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id))
    if not subscription:
        raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
    row = Proposal(actor_id=user.id, type="cancel_subscription", status="pending", title="Résilier à la fin de la période", resource={"type": "subscription", "id": subscription.id, "label": subscription.offer_snapshot["title"], "version": 1}, parameters={}, consequences=[f"Accès maintenu jusqu'au {iso(subscription.current_period_end)}.", "Aucun renouvellement automatique."], expires_at=utcnow() + timedelta(minutes=15), approval="self", origin="form")
    db.add(row)
    db.flush()
    record_audit(db, action="proposal.created", target_type="proposal", target_id=row.id, result="success", request_id="api", actor=user, metadata={"type": row.type})
    db.commit()
    return proposal_out(row)


@router.post("/subscriptions/{subscription_id}/plan-change-proposals", status_code=201)
def prepare_change(subscription_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if set(payload) != {"target_offer_id"}:
        raise DomainError(422, "INVALID_BODY", "Corps invalide.")
    subscription = db.scalar(select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id))
    if not subscription:
        raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
    row = Proposal(actor_id=user.id, type="change_plan", status="pending", title="Changer de formule à l'échéance", resource={"type": "subscription", "id": subscription.id, "label": subscription.offer_snapshot["title"], "version": 1}, parameters={"target_offer_id": payload["target_offer_id"]}, consequences=["Le changement prend effet à la prochaine échéance.", "Aucun prorata n'est appliqué."], expires_at=utcnow() + timedelta(minutes=15), approval="self", origin="form")
    db.add(row)
    db.commit()
    return proposal_out(row)


def decide(proposal_id: str, decision: str, key: str | None, db: Session, user: User) -> dict:
    row = db.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.actor_id == user.id).with_for_update())
    if not row:
        raise DomainError(404, "NOT_FOUND", "Proposition introuvable.")
    operation, replay = begin(db, user.id, f"proposal_{decision}", key, {"proposal_id": proposal_id})
    if replay is not None:
        return replay
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
    elif row.type == "cancel_subscription":
        subscription = db.scalar(select(Subscription).where(Subscription.id == row.resource["id"], Subscription.user_id == user.id).with_for_update())
        if not subscription or subscription.status != "active":
            raise DomainError(409, "PROPOSAL_STALE", "L'abonnement a changé depuis la préparation.")
        subscription.cancel_at_period_end = True
        subscription.history = [*subscription.history, {"at": iso(utcnow()), "label": "Résiliation programmée"}]
        row.status = "confirmed"
        row.result = {"summary": "Résiliation programmée à l'échéance.", "links": [{"label": "Voir l'abonnement", "to": f"/compte/abonnements/{subscription.id}"}]}
    elif row.type == "change_plan":
        subscription = db.scalar(select(Subscription).where(Subscription.id == row.resource["id"], Subscription.user_id == user.id).with_for_update())
        if not subscription or subscription.status != "active":
            raise DomainError(409, "PROPOSAL_STALE", "L'abonnement a changé depuis la préparation.")
        subscription.scheduled_change = {"target_offer_title": row.parameters["target_offer_id"], "effective_at": iso(subscription.current_period_end)}
        row.status = "confirmed"
        row.result = {"summary": "Changement programmé.", "links": [{"label": "Voir l'abonnement", "to": f"/compte/abonnements/{subscription.id}"}]}
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
    complete(operation, result, 200, "proposal", row.id)
    db.commit()
    return result


@router.post("/proposals/{proposal_id}/confirm")
def confirm(proposal_id: str, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    return decide(proposal_id, "confirm", idempotency_key, db, user)


@router.post("/proposals/{proposal_id}/reject")
def reject(proposal_id: str, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    return decide(proposal_id, "reject", idempotency_key, db, user)
