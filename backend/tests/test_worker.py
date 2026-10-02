from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import Conversation, DurableTask, Message, Run, TaskStatus, User
from app.workers.runner import claim_task, main

pytestmark = pytest.mark.postgres


def test_abandoned_lease_is_reclaimed_and_multi_agent_run_completes(database_url: str) -> None:
    with SessionLocal.begin() as db:
        for stale in db.scalars(
            select(DurableTask).where(DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]))
        ):
            stale.status = TaskStatus.completed
            stale.lease_until = None
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"])))
        conversation = Conversation(user_id=user.id, title="Test durable")
        db.add(conversation)
        db.flush()
        run = Run(
            conversation_id=conversation.id,
            user_id=user.id,
            status="queued",
            limits={"max_delegations": 4, "max_tool_calls": 12, "active_timeout_seconds": 120},
            trace_id="worker-test-trace",
        )
        db.add(run)
        db.flush()
        conversation.active_run_id = run.id
        task = DurableTask(
            kind="assistant_run",
            payload={
                "run_id": run.id,
                "text": "Compare les offres et abonnements, exclue ce qui est déjà couvert puis vérifie les conditions.",
            },
            status=TaskStatus.running,
            attempts=1,
            available_at=utcnow() - timedelta(minutes=2),
            lease_owner="dead-worker",
            lease_until=utcnow() - timedelta(minutes=1),
        )
        db.add(task)
        db.flush()
        task_id = task.id
        run_id = run.id

    assert claim_task() == task_id
    # Return it to the queue so main() exercises the normal claim and execution path.
    with SessionLocal.begin() as db:
        task = db.get(DurableTask, task_id)
        task.status = TaskStatus.queued
        task.lease_until = None
    main(once=True)
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run.status == "completed"
        assert len(run.checkpoint["specialist_results"]) == 3
        assert len(run.checkpoint.get("mcp_invocations", [])) >= 3
        assert db.scalar(select(Message).where(Message.run_id == run_id, Message.role == "assistant")) is not None
