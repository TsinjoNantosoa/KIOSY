import json
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import Conversation, Run, RunEvent, SessionRecord

pytestmark = pytest.mark.postgres


@pytest.fixture(scope="module")
def sse_http_base(database_url: str):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(  # noqa: S603
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],  # noqa: S603
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"SSE HTTP test server stopped: {stderr}")
        try:
            if httpx.get(f"{base}/health/ready", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        process.terminate()
        raise RuntimeError("SSE HTTP test server did not become ready")
    try:
        yield base
    finally:
        process.terminate()
        process.wait(timeout=10)


def csrf(client: TestClient) -> dict[str, str]:
    response = client.get("/v1/auth/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def register(client: TestClient) -> str:
    response = client.post(
        "/v1/auth/register",
        headers=csrf(client),
        json={
            "display_name": "SSE Reader",
            "email": f"sse-{uuid.uuid4()}@example.com",
            "password": "Correct-Horse-2026!",
            "accepted_terms_version": "mvp-2026-10-01",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["user"]["id"]


def create_run(user_id: str, statuses: list[str], final_status: str) -> str:
    with SessionLocal.begin() as db:
        conversation = Conversation(user_id=user_id, title="SSE integration")
        db.add(conversation)
        db.flush()
        run = Run(
            conversation_id=conversation.id,
            user_id=user_id,
            status=final_status,
            last_seq=len(statuses),
            steps=[],
            error=None,
            checkpoint={},
            limits={},
            trace_id=str(uuid.uuid4()),
        )
        db.add(run)
        db.flush()
        conversation.active_run_id = None if final_status == "completed" else run.id
        for seq, status in enumerate(statuses, start=1):
            db.add(
                RunEvent(
                    run_id=run.id,
                    seq=seq,
                    type="status",
                    payload={"status": status},
                    created_at=utcnow(),
                )
            )
        return run.id


def test_sse_orders_events_and_resumes_with_query_or_last_event_id(
    database_url: str, client: TestClient
) -> None:
    user_id = register(client)
    run_id = create_run(
        user_id,
        ["queued", "running", "waiting_user", "waiting_approval", "completed"],
        "completed",
    )

    response = client.get(f"/v1/runs/{run_id}/events", headers={"Accept": "text/event-stream"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    payloads = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert [item["seq"] for item in payloads] == [1, 2, 3, 4, 5]
    assert [item["status"] for item in payloads] == [
        "queued",
        "running",
        "waiting_user",
        "waiting_approval",
        "completed",
    ]

    query_resume = client.get(f"/v1/runs/{run_id}/events?after_seq=3")
    assert [item["seq"] for item in query_resume.json()] == [4, 5]
    header_resume = client.get(
        f"/v1/runs/{run_id}/events?after_seq=1", headers={"Last-Event-ID": "4"}
    )
    assert [item["seq"] for item in header_resume.json()] == [5]


def test_sse_heartbeat_disconnect_does_not_fail_run(database_url: str, client: TestClient) -> None:
    user_id = register(client)
    run_id = create_run(user_id, ["running"], "running")

    def complete_after_heartbeat() -> None:
        time.sleep(1.2)
        with SessionLocal.begin() as db:
            run = db.get(Run, run_id)
            assert run is not None
            run.status = "completed"
            run.last_seq = 2
            db.add(
                RunEvent(
                    run_id=run_id,
                    seq=2,
                    type="status",
                    payload={"status": "completed"},
                    created_at=utcnow(),
                )
            )

    thread = threading.Thread(target=complete_after_heartbeat, daemon=True)
    thread.start()
    response = client.get(f"/v1/runs/{run_id}/events", headers={"Accept": "text/event-stream"})
    thread.join(timeout=5)

    assert response.status_code == 200
    assert ": heartbeat" in response.text
    assert "\"status\": \"completed\"" in response.text
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.error is None


def test_sse_rejects_other_user_and_expired_session(database_url: str, client: TestClient) -> None:
    owner_id = register(client)
    run_id = create_run(owner_id, ["completed"], "completed")
    other_id = register(client)

    forbidden = client.get(f"/v1/runs/{run_id}/events")
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "FORBIDDEN"

    with SessionLocal.begin() as db:
        sessions = db.scalars(select(SessionRecord).where(SessionRecord.user_id == other_id)).all()
        for session in sessions:
            session.expires_at = utcnow() - timedelta(seconds=1)

    expired = client.get(f"/v1/runs/{run_id}/events")
    assert expired.status_code == 401
    assert expired.json()["code"] == "UNAUTHENTICATED"


def test_real_sse_disconnect_and_reconnect_keeps_run_healthy(
    database_url: str, sse_http_base: str
) -> None:
    with httpx.Client(base_url=sse_http_base, timeout=10) as http:
        token = http.get("/v1/auth/csrf").json()["token"]
        registered = http.post(
            "/v1/auth/register",
            headers={"X-CSRF-Token": token},
            json={
                "display_name": "SSE TCP Reader",
                "email": f"sse-tcp-{uuid.uuid4()}@example.com",
                "password": "Correct-Horse-2026!",
                "accepted_terms_version": "mvp-2026-10-01",
            },
        )
        assert registered.status_code == 200, registered.text
        run_id = create_run(registered.json()["user"]["id"], ["running"], "running")

        with http.stream(
            "GET", f"/v1/runs/{run_id}/events", headers={"Accept": "text/event-stream"}
        ) as stream:
            assert stream.status_code == 200
            first_id = next(line for line in stream.iter_lines() if line.startswith("id: "))
            assert first_id == "id: 1"
        with SessionLocal() as db:
            run = db.get(Run, run_id)
            assert run is not None
            assert run.status == "running"
            assert run.error is None

        with SessionLocal.begin() as db:
            run = db.get(Run, run_id)
            assert run is not None
            run.status = "completed"
            run.last_seq = 2
            db.add(
                RunEvent(
                    run_id=run_id,
                    seq=2,
                    type="status",
                    payload={"status": "completed"},
                    created_at=utcnow(),
                )
            )

        with http.stream(
            "GET",
            f"/v1/runs/{run_id}/events?after_seq=1",
            headers={"Accept": "text/event-stream", "Last-Event-ID": "1"},
        ) as resumed:
            assert resumed.status_code == 200
            body = "\n".join(resumed.iter_lines())
        assert "id: 2" in body
        assert '"status": "completed"' in body
