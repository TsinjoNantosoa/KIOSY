import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import Proposal, User

pytestmark = pytest.mark.postgres


def csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.get("/v1/auth/csrf").json()["token"]}


def register_reader(client: TestClient) -> tuple[dict[str, str], str]:
    headers = csrf(client)
    email = f"proposal-{uuid.uuid4()}@example.com"
    response = client.post(
        "/v1/auth/register",
        headers=headers,
        json={
            "display_name": "Proposal Reader",
            "email": email,
            "password": "Correct-Horse-2026!",
            "accepted_terms_version": "mvp-2026-10-01",
        },
    )
    assert response.status_code == 200, response.text
    return csrf(client), response.json()["user"]["id"]


def test_expired_proposal_returns_409(database_url: str, client: TestClient) -> None:
    headers, user_id = register_reader(client)
    with SessionLocal.begin() as db:
        user = db.get(User, user_id)
        row = Proposal(
            actor_id=user.id,
            type="cancel_subscription",
            status="pending",
            title="Test expiré",
            resource={"type": "subscription", "id": "missing", "label": "Test", "version": 1},
            parameters={},
            consequences=[],
            expires_at=utcnow() - timedelta(minutes=1),
            approval="self",
            origin="test",
        )
        db.add(row)
        db.flush()
        proposal_id = row.id
    response = client.post(
        f"/v1/proposals/{proposal_id}/confirm", headers={**headers, "Idempotency-Key": str(uuid.uuid4())}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "PROPOSAL_EXPIRED"
