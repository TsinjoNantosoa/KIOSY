import uuid

import pytest
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import AuditEvent, User
from app.domains.audit import record_audit

pytestmark = pytest.mark.postgres


def test_audit_metadata_is_recursively_redacted(database_url: str) -> None:
    target_id = str(uuid.uuid4())
    request_id = f"audit-{target_id}"
    with SessionLocal.begin() as db:
        actor = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
        record_audit(
            db,
            action="security.redaction_test",
            target_type="test",
            target_id=target_id,
            result="success",
            request_id=request_id,
            actor=actor,
            metadata={
                "safe": "visible",
                "nested": {"access_token": "must-not-leak", "password": "must-not-leak"},
                "items": [{"signed_url": "must-not-leak", "state": "ok"}],
            },
        )

    with SessionLocal() as db:
        event = db.scalar(select(AuditEvent).where(AuditEvent.request_id == request_id))
        assert event is not None
        assert event.metadata_json["safe"] == "visible"
        assert event.metadata_json["nested"] == {"access_token": "[REDACTED]", "password": "[REDACTED]"}
        assert event.metadata_json["items"] == [{"signed_url": "[REDACTED]", "state": "ok"}]
