import secrets
from typing import Any

from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import SupportCase, SupportMessage, User


def create_support_case(
    db: Session,
    user: User,
    *,
    subject: str,
    category: str,
    body: str,
    order_id: str | None = None,
    edition_id: str | None = None,
    subscription_id: str | None = None,
) -> SupportCase:
    row = SupportCase(
        reference=f"SUP-{utcnow():%Y%m%d}-{secrets.token_hex(3).upper()}",
        requester_id=user.id,
        subject=subject,
        category=category,
        status="open",
        related={"order_id": order_id, "edition_id": edition_id, "subscription_id": subscription_id},
    )
    db.add(row)
    db.flush()
    db.add(
        SupportMessage(
            case_id=row.id, author_id=user.id, author_kind="reader", body=body, created_at=utcnow()
        )
    )
    db.flush()
    return row


def case_summary(db: Session, row: SupportCase) -> dict[str, Any]:
    requester = db.get(User, row.requester_id)
    return {
        "id": row.id,
        "reference": row.reference,
        "subject": row.subject,
        "category": row.category,
        "status": row.status,
        "requester_label": requester.display_name if requester else "Lecteur",
    }
