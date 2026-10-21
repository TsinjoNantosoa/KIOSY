from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.providers import embedding_provider_from_settings
from app.ai.retrieval import RetrievalIndex
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import require_roles
from app.db.base import get_db
from app.db.models import DurableTask, RagPassage, TaskStatus, User
from app.domains.commerce_service import enqueue

router = APIRouter(prefix="/v1/admin/rag")


@router.get("/health")
def rag_health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(require_roles("manager", "admin")),
) -> dict[str, Any]:
    try:
        provider = embedding_provider_from_settings(settings)
        report = RetrievalIndex(settings, provider).health(db)
    except DomainError as error:
        report = {
            "status": "unavailable",
            "reason": error.code,
            "provider": {"configured": False},
            "database_passages": {},
            "qdrant_points": {},
            "missing_collections": ["catalog", "edition_content", "contract"],
        }
    report["active_passages_all_spaces"] = int(
        db.scalar(
            select(func.count()).select_from(RagPassage).where(RagPassage.withdrawn_at.is_(None))
        )
        or 0
    )
    latest = db.scalar(
        select(DurableTask)
        .where(DurableTask.kind == "rag_reindex")
        .order_by(DurableTask.created_at.desc())
        .limit(1)
    )
    report["latest_reindex"] = (
        {
            "id": latest.id,
            "status": latest.status.value,
            "attempts": latest.attempts,
            "last_error": latest.last_error,
            "created_at": latest.created_at.isoformat(),
        }
        if latest
        else None
    )
    return report


@router.post("/reindex", status_code=202)
def reindex_rag(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> dict[str, Any]:
    active = db.scalar(
        select(DurableTask).where(
            DurableTask.kind == "rag_reindex",
            DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]),
        )
    )
    task = active or enqueue(db, "rag_reindex", {})
    db.commit()
    return {"task_id": task.id, "status": task.status.value}
