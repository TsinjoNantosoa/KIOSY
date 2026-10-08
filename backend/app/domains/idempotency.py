import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import DomainError
from app.core.security import utcnow
from app.db.models import IdempotencyOperation


def fingerprint(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def begin(
    db: Session, actor_id: str, operation: str, key: str | None, payload: Any
) -> tuple[IdempotencyOperation, dict[str, Any] | None]:
    if not key or len(key) > 160:
        raise DomainError(422, "IDEMPOTENCY_KEY_REQUIRED", "Une clé d'idempotence valide est requise.")
    digest = fingerprint(payload)
    existing = db.scalar(
        select(IdempotencyOperation).where(
            IdempotencyOperation.actor_id == actor_id,
            IdempotencyOperation.operation == operation,
            IdempotencyOperation.key == key,
        )
    )
    if existing:
        if existing.request_hash != digest:
            raise DomainError(
                409, "IDEMPOTENCY_MISMATCH", "Cette clé a déjà été utilisée pour une autre requête."
            )
        if existing.state == "completed" and existing.response_body is not None:
            return existing, existing.response_body
        raise DomainError(
            409, "OPERATION_IN_PROGRESS", "L'opération est encore en cours. Consultez son état."
        )
    row = IdempotencyOperation(
        actor_id=actor_id,
        operation=operation,
        key=key,
        request_hash=digest,
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(days=7),
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return begin(db, actor_id, operation, key, payload)
    return row, None


def complete(
    row: IdempotencyOperation, body: dict[str, Any], status: int, resource_type: str, resource_id: str
) -> None:
    row.state = "completed"
    row.response_body = body
    row.response_status = status
    row.resource_type = resource_type
    row.resource_id = resource_id
