
from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import SupportCreateInput, SupportReplyInput
from app.api.serializers import iso
from app.core.errors import DomainError
from app.core.security import current_user, utcnow
from app.db.base import get_db
from app.db.models import SupportCase, SupportMessage, User
from app.domains.idempotency import begin, complete
from app.domains.support_service import create_support_case as persist_support_case

router = APIRouter(prefix="/v1")


def case_out(db: Session, row: SupportCase) -> dict:
    requester = db.get(User, row.requester_id)
    assignee = db.get(User, row.assignee_id) if row.assignee_id else None
    messages = []
    for message in db.scalars(select(SupportMessage).where(SupportMessage.case_id == row.id).order_by(SupportMessage.created_at)):
        author = db.get(User, message.author_id) if message.author_id else None
        messages.append({"id": message.id, "author": message.author_kind, "author_label": author.display_name if author else "Système", "body": message.body, "at": iso(message.created_at)})
    return {"id": row.id, "reference": row.reference, "subject": row.subject, "category": row.category, "status": row.status, "created_at": iso(row.created_at), "updated_at": iso(row.updated_at), "requester": {"id": requester.id, "label": requester.display_name}, "assignee": {"id": assignee.id, "label": assignee.display_name} if assignee else None, "related": row.related, "messages": messages}


@router.get("/me/support-cases")
def cases(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict]:
    return [case_out(db, row) for row in db.scalars(select(SupportCase).where(SupportCase.requester_id == user.id).order_by(SupportCase.updated_at.desc()))]


@router.post("/me/support-cases", status_code=201)
def create_case(payload: SupportCreateInput, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    operation, replay = begin(db, user.id, "create_support_case", idempotency_key, payload.model_dump(mode="json"))
    if replay is not None:
        return replay
    row = persist_support_case(
        db,
        user,
        subject=payload.subject,
        category=payload.category,
        body=payload.body,
        order_id=payload.order_id,
        edition_id=payload.edition_id,
        subscription_id=payload.subscription_id,
    )
    result = case_out(db, row)
    complete(operation, result, 201, "support_case", row.id)
    db.commit()
    return result


@router.get("/support-cases/{case_id}")
def get_case(case_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    statement = select(SupportCase).where(SupportCase.id == case_id)
    if not set(user.roles).intersection({"support", "manager", "admin"}):
        statement = statement.where(SupportCase.requester_id == user.id)
    row = db.scalar(statement)
    if not row:
        raise DomainError(404, "NOT_FOUND", "Demande introuvable.")
    return case_out(db, row)


@router.post("/support-cases/{case_id}/messages")
def reply(case_id: str, payload: SupportReplyInput, idempotency_key: str | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(SupportCase).where(SupportCase.id == case_id, SupportCase.requester_id == user.id).with_for_update())
    if not row:
        raise DomainError(404, "NOT_FOUND", "Demande introuvable.")
    operation, replay = begin(db, user.id, "reply_support_case", idempotency_key, {"case_id": case_id, "body_hash": __import__("hashlib").sha256(payload.body.encode()).hexdigest()})
    if replay is not None:
        return replay
    db.add(SupportMessage(case_id=row.id, author_id=user.id, author_kind="reader", body=payload.body, created_at=utcnow()))
    row.status = "open"
    db.flush()
    result = case_out(db, row)
    complete(operation, result, 200, "support_case", row.id)
    db.commit()
    return result
