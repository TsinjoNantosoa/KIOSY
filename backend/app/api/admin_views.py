from datetime import timedelta

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.account import entitlement_out, subscription_out
from app.api.assistant import run_out
from app.api.serializers import iso, order_out
from app.api.support import case_out
from app.core.errors import DomainError
from app.core.security import require_roles, utcnow
from app.db.base import get_db
from app.db.models import (
    Approval,
    AuditEvent,
    DurableTask,
    Edition,
    Entitlement,
    ImportJob,
    Order,
    PaymentAttempt,
    Proposal,
    Run,
    Subscription,
    SupportCase,
    SupportMessage,
    User,
)
from app.domains.idempotency import begin, complete

router = APIRouter(prefix="/v1/admin")


def user_ref(row: User | None) -> dict | None:
    return {"id": row.id, "display_name": row.display_name, "email": row.email} if row else None


def count(db: Session, model: type, *criteria: object) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*criteria)) or 0)


@router.get("/ops")
def ops(db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> dict:
    return {
        "generated_at": iso(utcnow()),
        "is_demo": False,
        "counts": {
            "publications_in_review": count(db, Edition, Edition.status == "review"),
            "imports_failed": count(db, ImportJob, ImportJob.status == "failed"),
            "orders_pending_payment": count(db, Order, Order.status == "pending_payment"),
            "payment_exceptions": count(db, Order, Order.status == "payment_exception"),
            "tickets_open": count(db, SupportCase, SupportCase.status.in_(["open", "in_progress", "waiting_reader"])),
            "approvals_pending": count(db, Approval, Approval.status == "pending"),
            "runs_failed": count(db, Run, Run.status == "failed"),
            "proposals_expired": count(db, Proposal, Proposal.status == "expired"),
        },
    }


@router.get("/orders")
def orders(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    statement = select(Order, User).join(User, User.id == Order.user_id).order_by(Order.created_at.desc())
    if status:
        statement = statement.where(Order.status == status)
    result = []
    for row, customer in db.execute(statement):
        payment = db.scalar(select(PaymentAttempt).where(PaymentAttempt.order_id == row.id).order_by(PaymentAttempt.created_at.desc()))
        result.append({**order_out(row, payment, None), "customer": user_ref(customer)})
    return result


@router.post("/orders/{order_id}/reconcile")
def reconcile(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("manager", "admin"))) -> dict:
    row = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not row:
        raise DomainError(404, "NOT_FOUND", "Commande introuvable.")
    payment = db.scalar(select(PaymentAttempt).where(PaymentAttempt.order_id == row.id).order_by(PaymentAttempt.created_at.desc()))
    return order_out(row, payment, None)


@router.get("/subscriptions")
def subscriptions(db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    return [{**subscription_out(row), "customer": user_ref(customer)} for row, customer in db.execute(select(Subscription, User).join(User, User.id == Subscription.user_id).order_by(Subscription.created_at.desc()))]


@router.get("/users")
def users(db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    return [user_ref(row) for row in db.scalars(select(User).order_by(User.display_name))]


@router.get("/entitlements")
def entitlements(user_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    return [entitlement_out(row) for row in db.scalars(select(Entitlement).where(Entitlement.user_id == user_id).order_by(Entitlement.created_at.desc()))]


@router.get("/support-cases")
def support_cases(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    statement = select(SupportCase).order_by(SupportCase.updated_at.desc())
    if status:
        statement = statement.where(SupportCase.status == status)
    return [case_out(db, row) for row in db.scalars(statement)]


@router.get("/support-cases/{case_id}")
def support_case(case_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> dict:
    row = db.get(SupportCase, case_id)
    if not row:
        raise DomainError(404, "NOT_FOUND", "Demande introuvable.")
    return case_out(db, row)


@router.post("/support-cases/{case_id}/messages")
def reply_support(case_id: str, payload: dict, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> dict:
    if set(payload) != {"body", "status"} or payload["status"] not in {"open", "in_progress", "waiting_reader", "resolved", "closed"}:
        raise DomainError(422, "INVALID_BODY", "Réponse support invalide.")
    row = db.scalar(select(SupportCase).where(SupportCase.id == case_id).with_for_update())
    if not row:
        raise DomainError(404, "NOT_FOUND", "Demande introuvable.")
    operation, replay = begin(db, user.id, "admin_reply_support", idempotency_key, {"case_id": case_id, "body": payload["body"], "status": payload["status"]})
    if replay is not None:
        return replay
    db.add(SupportMessage(case_id=row.id, author_id=user.id, author_kind="support", body=str(payload["body"])[:10_000], created_at=utcnow()))
    row.status = payload["status"]
    row.assignee_id = user.id
    db.flush()
    result = case_out(db, row)
    complete(operation, result, 200, "support_case", row.id)
    db.commit()
    return result


@router.post("/support-cases/{case_id}/access-exceptions", status_code=201)
def request_exception(case_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> dict:
    if set(payload) != {"reason", "edition_id", "days"} or not isinstance(payload["days"], int) or not 1 <= payload["days"] <= 90:
        raise DomainError(422, "INVALID_BODY", "Demande d'exception invalide.")
    case = db.get(SupportCase, case_id)
    edition = db.get(Edition, payload["edition_id"])
    if not case or not edition:
        raise DomainError(404, "NOT_FOUND", "Dossier ou édition introuvable.")
    proposal = Proposal(actor_id=case.requester_id, type="access_exception", status="waiting_approval", title="Exception temporaire d'accès", resource={"type": "edition", "id": edition.id, "label": edition.label, "version": edition.version}, parameters={"days": payload["days"]}, consequences=[f"Accès temporaire pendant {payload['days']} jour(s)."], expires_at=utcnow() + timedelta(days=2), approval="manager", origin="support")
    db.add(proposal)
    db.flush()
    approval = Approval(proposal_id=proposal.id, requested_by_id=user.id, reason=str(payload["reason"])[:2000], status="pending", case_id=case.id)
    db.add(approval)
    db.commit()
    return approval_out(db, approval, proposal)


def approval_out(db: Session, row: Approval, proposal: Proposal | None = None) -> dict:
    proposal = proposal or db.get(Proposal, row.proposal_id)
    requested = db.get(User, row.requested_by_id)
    decided = db.get(User, row.decided_by_id) if row.decided_by_id else None
    return {"id": row.proposal_id, "proposal": {"id": proposal.id, "type": proposal.type, "status": proposal.status, "title": proposal.title, "resource": proposal.resource, "consequences": proposal.consequences, "amount": proposal.amount, "conditions_version": proposal.conditions_version, "expires_at": iso(proposal.expires_at), "approval": proposal.approval, "origin": proposal.origin, "created_at": iso(proposal.created_at), "result": proposal.result}, "requested_by": {"id": requested.id, "label": requested.display_name}, "reason": row.reason, "status": row.status, "decided_by": {"id": decided.id, "label": decided.display_name} if decided else None, "decided_at": iso(row.decided_at), "case_id": row.case_id}


@router.get("/approvals")
def approvals(db: Session = Depends(get_db), user: User = Depends(require_roles("manager", "admin"))) -> list[dict]:
    return [approval_out(db, row) for row in db.scalars(select(Approval).order_by(Approval.created_at.desc()))]


@router.post("/approvals/{proposal_id}/decision")
def decide_approval(proposal_id: str, payload: dict, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(require_roles("manager", "admin"))) -> dict:
    if set(payload) != {"decision", "reason"} or payload["decision"] not in {"approve", "reject"}:
        raise DomainError(422, "INVALID_BODY", "Décision invalide.")
    approval = db.scalar(select(Approval).where(Approval.proposal_id == proposal_id).with_for_update())
    proposal = db.scalar(select(Proposal).where(Proposal.id == proposal_id).with_for_update())
    if not approval or not proposal:
        raise DomainError(404, "NOT_FOUND", "Approbation introuvable.")
    operation, replay = begin(db, user.id, "decide_approval", idempotency_key, {"proposal_id": proposal_id, **payload})
    if replay is not None:
        return replay
    if approval.requested_by_id == user.id:
        raise DomainError(403, "SEPARATION_OF_DUTIES", "Le demandeur ne peut pas approuver sa propre exception.")
    if approval.status != "pending" or proposal.expires_at <= utcnow():
        raise DomainError(409, "APPROVAL_STALE", "Cette approbation n'est plus active.")
    approval.status = "approved" if payload["decision"] == "approve" else "rejected"
    approval.decided_by_id = user.id
    approval.decided_at = utcnow()
    proposal.status = "confirmed" if approval.status == "approved" else "rejected"
    if approval.status == "approved":
        db.add(Entitlement(user_id=proposal.actor_id, source="exception", source_ref=proposal.id, scope={"kind": "edition", "edition_id": proposal.resource["id"]}, valid_from=utcnow(), valid_until=utcnow() + timedelta(days=int(proposal.parameters["days"])), status="active"))
    proposal.result = {"summary": "Exception accordée." if approval.status == "approved" else "Exception refusée.", "links": []}
    db.flush()
    result = approval_out(db, approval, proposal)
    complete(operation, result, 200, "approval", proposal.id)
    db.commit()
    return result


@router.get("/audit-events")
def audit_events(q: str | None = None, result: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles("manager", "admin"))) -> dict:
    statement = select(AuditEvent).order_by(AuditEvent.at.desc())
    if q:
        statement = statement.where(or_(AuditEvent.action.ilike(f"%{q}%"), AuditEvent.target_id.ilike(f"%{q}%")))
    if result:
        statement = statement.where(AuditEvent.result == result)
    rows = list(db.scalars(statement.limit(100)))
    return {"items": [{"id": row.id, "at": iso(row.at), "actor": {"id": row.actor_id or "system", "label": row.actor_id or "Système", "role": row.actor_role}, "action": row.action, "target": {"type": row.target_type, "id": row.target_id, "label": row.target_id}, "reason": row.reason, "result": row.result, "request_id": row.request_id} for row in rows], "page": 1, "page_size": 100, "total": len(rows), "has_next": False}


@router.get("/runs")
def runs(db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> list[dict]:
    return [run_diagnostic(db, row) for row in db.scalars(select(Run).order_by(Run.created_at.desc()).limit(100))]


@router.get("/runs/{run_id}")
def run(run_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("support", "manager", "admin"))) -> dict:
    row = db.get(Run, run_id)
    if not row:
        raise DomainError(404, "NOT_FOUND", "Run introuvable.")
    return run_diagnostic(db, row)


def run_diagnostic(db: Session, row: Run) -> dict:
    actor = db.get(User, row.user_id)
    task = db.scalar(select(DurableTask).where(DurableTask.kind == "assistant_run", DurableTask.payload["run_id"].as_string() == row.id))
    return {"run": run_out(row), "actor_label": actor.display_name if actor else row.user_id, "request_summary": "Demande assistant", "model": "configuration serveur", "prompt_version": "mvp-1", "steps": [], "tokens": None, "cost": {"amount_usd": None, "kind": "unavailable", "tariff_version": None}, "is_simulated": False, "task_status": task.status.value if task else None}
