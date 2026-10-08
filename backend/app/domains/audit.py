from typing import Any

from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import AuditEvent, User

_SENSITIVE_PARTS = ("token", "cookie", "secret", "password", "authorization", "signed_url", "card")


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]"
            if any(part in str(key).casefold() for part in _SENSITIVE_PARTS)
            else _sanitize(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize(item) for item in value[:50]]
    if isinstance(value, str):
        return value[:500]
    return value


def record_audit(
    db: Session,
    *,
    action: str,
    target_type: str,
    target_id: str,
    result: str,
    request_id: str,
    actor: User | None = None,
    actor_role: str | None = None,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    row = AuditEvent(
        at=utcnow(),
        actor_id=actor.id if actor else None,
        actor_role=actor_role or (actor.roles[0] if actor and actor.roles else "system"),
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        result=result,
        request_id=request_id,
        metadata_json=_sanitize(metadata or {}),
    )
    db.add(row)
    return row
