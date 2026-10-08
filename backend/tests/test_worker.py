from datetime import timedelta

import pytest
from sqlalchemy import select

from app.api.proposals import decide
from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import (
    Conversation,
    DurableTask,
    Message,
    Order,
    OutboxEvent,
    Proposal,
    Run,
    TaskStatus,
    User,
)
from app.domains.commerce_service import enqueue
from app.workers.runner import claim_task, dispatch_outbox, fail, finish, main, renew_lease

pytestmark = pytest.mark.postgres


def test_abandoned_lease_is_reclaimed_and_multi_agent_run_completes(database_url: str) -> None:
    with SessionLocal.begin() as db:
        for stale in db.scalars(
            select(DurableTask).where(DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]))
        ):
            stale.status = TaskStatus.completed
            stale.lease_until = None
    with SessionLocal.begin() as db:
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
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

    claimed = claim_task()
    assert claimed is not None and claimed.id == task_id
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
        assert (
            db.scalar(select(Message).where(Message.run_id == run_id, Message.role == "assistant"))
            is not None
        )


def test_waiting_user_resumes_same_langgraph_thread(database_url: str) -> None:
    with SessionLocal.begin() as db:
        for stale in db.scalars(
            select(DurableTask).where(DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]))
        ):
            stale.status = TaskStatus.completed
            stale.lease_until = None
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
        conversation = Conversation(user_id=user.id, title="Clarification durable")
        db.add(conversation)
        db.flush()
        run = Run(
            conversation_id=conversation.id,
            user_id=user.id,
            status="queued",
            limits={
                "max_delegations": 4,
                "max_tool_calls": 12,
                "max_llm_calls": 6,
                "active_timeout_seconds": 120,
            },
            trace_id=str(__import__("uuid").uuid4()),
        )
        db.add(run)
        db.flush()
        conversation.active_run_id = run.id
        enqueue(
            db, "assistant_run", {"run_id": run.id, "text": "Je cherche quelque chose pour mon abonnement."}
        )
        run_id = run.id

    main(once=True)
    with SessionLocal.begin() as db:
        run = db.get(Run, run_id)
        assert run.status == "waiting_user"
        clarification = db.scalar(
            select(Message)
            .where(Message.run_id == run_id, Message.role == "assistant")
            .order_by(Message.created_at.desc())
        )
        assert clarification.blocks[0]["type"] == "clarification"
        run.status = "queued"
        enqueue(
            db, "assistant_resume", {"run_id": run.id, "resume": {"text": "Je cherche une lecture culture."}}
        )

    main(once=True)
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run.status == "completed"
        assert db.get(Conversation, run.conversation_id).active_run_id is None
        assert (
            len(
                list(db.scalars(select(Message).where(Message.run_id == run_id, Message.role == "assistant")))
            )
            == 2
        )


def test_waiting_approval_revalidates_executes_once_and_resumes(database_url: str) -> None:
    email = f"approval-worker-{__import__('uuid').uuid4()}@example.com"
    with SessionLocal.begin() as db:
        for stale in db.scalars(
            select(DurableTask).where(DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]))
        ):
            stale.status = TaskStatus.completed
            stale.lease_until = None
        user = User(
            email=email,
            display_name="Approval Worker",
            password_hash=hash_password("Correct-Horse-2026!"),
            roles=["reader"],
        )
        db.add(user)
        db.flush()
        conversation = Conversation(user_id=user.id, title="Approbation durable")
        db.add(conversation)
        db.flush()
        run = Run(
            conversation_id=conversation.id,
            user_id=user.id,
            status="queued",
            limits={
                "max_delegations": 4,
                "max_tool_calls": 12,
                "max_llm_calls": 6,
                "active_timeout_seconds": 120,
            },
            trace_id=str(__import__("uuid").uuid4()),
        )
        db.add(run)
        db.flush()
        conversation.active_run_id = run.id
        enqueue(db, "assistant_run", {"run_id": run.id, "text": "Achète une offre culture pour moi."})
        run_id = run.id
        user_id = user.id

    main(once=True)
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run.status == "waiting_approval"
        proposal = db.scalar(
            select(Proposal).where(Proposal.actor_id == user_id, Proposal.status == "pending")
        )
        assert proposal is not None
        assert proposal.parameters["_run_id"] == run_id
        proposal_id = proposal.id

    with SessionLocal() as db:
        user = db.get(User, user_id)
        first = decide(proposal_id, "confirm", "approval-once-1", db, user, get_settings())
    assert first["status"] == "confirmed"
    main(once=True)

    with SessionLocal() as db:
        user = db.get(User, user_id)
        order_count = len(list(db.scalars(select(Order).where(Order.user_id == user_id))))
        repeated = decide(proposal_id, "confirm", "approval-once-2", db, user, get_settings())
        run = db.get(Run, run_id)
        assert run.status == "completed"
        assert repeated["result"] == first["result"]
        assert len(list(db.scalars(select(Order).where(Order.user_id == user_id)))) == order_count == 1


def test_fencing_heartbeat_retry_status_and_outbox_recovery(database_url: str) -> None:
    with SessionLocal.begin() as db:
        for stale in db.scalars(
            select(DurableTask).where(DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]))
        ):
            stale.status = TaskStatus.completed
            stale.lease_until = None
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
        conversation = Conversation(user_id=user.id, title="Fencing")
        db.add(conversation)
        db.flush()
        run = Run(
            conversation_id=conversation.id,
            user_id=user.id,
            status="running",
            limits={},
            trace_id=str(__import__("uuid").uuid4()),
        )
        db.add(run)
        db.flush()
        task = enqueue(db, "assistant_run", {"run_id": run.id, "text": "test"})
        outbox = OutboxEvent(
            topic="test.committed", aggregate_id=run.id, payload={"run_id": run.id}, created_at=utcnow()
        )
        db.add(outbox)
        db.flush()
        task_id, run_id, outbox_id = task.id, run.id, outbox.id

    first = claim_task()
    assert first is not None and first.id == task_id
    assert renew_lease(first)
    assert fail(first, RuntimeError("transient"))
    with SessionLocal.begin() as db:
        task = db.get(DurableTask, task_id)
        run = db.get(Run, run_id)
        assert task.status == TaskStatus.queued
        assert run.status == "queued"
        task.available_at = utcnow()

    second = claim_task()
    assert second is not None and second.id == task_id and second.lease_owner != first.lease_owner
    assert not finish(first)
    assert finish(second)
    assert outbox_id in dispatch_outbox()
    with SessionLocal() as db:
        assert db.get(OutboxEvent, outbox_id).published_at is not None
