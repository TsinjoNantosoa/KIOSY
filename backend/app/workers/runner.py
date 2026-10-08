import signal
import socket
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from typing import Any

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from pypdf import PdfReader
from sqlalchemy import or_, select

from app.ai.orchestration import build_graph
from app.ai.providers import provider_from_settings
from app.ai.retrieval import PassageInput, RetrievalIndex
from app.api.assistant import append_event
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import (
    Asset,
    Conversation,
    DurableTask,
    Edition,
    ImportJob,
    Message,
    OutboxEvent,
    Proposal,
    Publication,
    Run,
    TaskStatus,
)
from app.domains.email import EmailSender
from app.domains.storage import S3Storage

settings = get_settings()
worker_id = f"{socket.gethostname()}:{__import__('os').getpid()}"
shutdown_requested = threading.Event()


@dataclass(frozen=True)
class ClaimedTask:
    id: str
    lease_owner: str


def claim_task() -> ClaimedTask | None:
    now = utcnow()
    with SessionLocal.begin() as db:
        task = db.scalar(
            select(DurableTask)
            .where(
                DurableTask.status.in_([TaskStatus.queued, TaskStatus.running]),
                DurableTask.available_at <= now,
                or_(DurableTask.lease_until.is_(None), DurableTask.lease_until < now),
            )
            .order_by(DurableTask.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not task:
            return None
        task.status = TaskStatus.running
        task.attempts += 1
        lease_owner = f"{worker_id}:{uuid.uuid4()}"
        task.lease_owner = lease_owner
        task.lease_until = now + timedelta(seconds=settings.worker_lease_seconds)
        return ClaimedTask(task.id, lease_owner)


def renew_lease(claim: ClaimedTask) -> bool:
    with SessionLocal.begin() as db:
        task = db.scalar(select(DurableTask).where(DurableTask.id == claim.id).with_for_update())
        if not task or task.status != TaskStatus.running or task.lease_owner != claim.lease_owner:
            return False
        task.lease_until = utcnow() + timedelta(seconds=settings.worker_lease_seconds)
        return True


@contextmanager
def lease_heartbeat(claim: ClaimedTask):
    stopped = threading.Event()
    lost = threading.Event()

    def heartbeat() -> None:
        while not stopped.wait(settings.worker_heartbeat_seconds):
            if not renew_lease(claim):
                lost.set()
                return

    thread = threading.Thread(target=heartbeat, name=f"lease-{claim.id}", daemon=True)
    thread.start()
    try:
        yield lost
    finally:
        stopped.set()
        thread.join(timeout=2)


def assert_lease(db: Any, claim: ClaimedTask) -> DurableTask:
    task = db.scalar(select(DurableTask).where(DurableTask.id == claim.id).with_for_update())
    if (
        not task
        or task.status != TaskStatus.running
        or task.lease_owner != claim.lease_owner
        or not task.lease_until
        or task.lease_until <= utcnow()
    ):
        raise RuntimeError("TASK_LEASE_LOST")
    return task


def finish(claim: ClaimedTask) -> bool:
    with SessionLocal.begin() as db:
        task = db.scalar(select(DurableTask).where(DurableTask.id == claim.id).with_for_update())
        if task and task.status == TaskStatus.running and task.lease_owner == claim.lease_owner:
            task.status = TaskStatus.completed
            task.lease_until = None
            task.lease_owner = None
            if task.kind == "send_password_reset":
                task.payload = {}
            return True
        return False


def fail(claim: ClaimedTask, error: Exception) -> bool:
    with SessionLocal.begin() as db:
        task = db.scalar(select(DurableTask).where(DurableTask.id == claim.id).with_for_update())
        if not task or task.lease_owner != claim.lease_owner:
            return False
        task.last_error = f"{type(error).__name__}: {str(error)[:500]}"
        task.lease_until = None
        task.lease_owner = None
        run_id = task.payload.get("run_id") if task.kind in {"assistant_run", "assistant_resume"} else None
        run = db.scalar(select(Run).where(Run.id == run_id).with_for_update()) if run_id else None
        if task.attempts >= task.max_attempts:
            task.status = TaskStatus.failed
            if run and run.status != "cancelled":
                run.status = "failed"
                run.error = {
                    "code": "RUN_FAILED",
                    "message": "L'assistant n'a pas pu terminer cette demande après plusieurs tentatives.",
                }
                append_event(db, run, "error", run.error)
        else:
            task.status = TaskStatus.queued
            task.available_at = utcnow() + timedelta(seconds=min(60, 2**task.attempts))
            if run and run.status != "cancelled":
                run.status = "queued"
                append_event(db, run, "status", {"status": "queued", "retry": task.attempts})
        return True


def process_assistant(payload: dict[str, Any], graph: Any, claim: ClaimedTask) -> None:
    run_id = payload["run_id"]
    with SessionLocal.begin() as db:
        assert_lease(db, claim)
        run = db.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if not run or run.status == "cancelled":
            return
        run.status = "running"
        append_event(db, run, "status", {"status": "running"})
    started = time.monotonic()
    graph_input: Any
    if "resume" in payload:
        graph_input = Command(resume=payload["resume"])
    else:
        graph_input = {
            "text": payload["text"],
            "user_id": run.user_id,
            "trace_id": run.trace_id,
            "limits": run.limits or {},
            "specialist_results": [],
            "mcp_invocations": [],
            "delegations": 0,
            "tool_call_count": 0,
            "llm_call_count": 0,
            "tokens_input": 0,
            "tokens_output": 0,
            "estimated_cost": 0.0,
            "active_elapsed_seconds": 0.0,
            "active_started_at": time.monotonic(),
            "workflow_status": "running",
        }
    result = graph.invoke(graph_input, config={"configurable": {"thread_id": run.id}})
    active_elapsed = float(run.checkpoint.get("active_elapsed_seconds", 0.0)) + (time.monotonic() - started)
    with SessionLocal.begin() as db:
        assert_lease(db, claim)
        run = db.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if not run or run.status == "cancelled":
            return
        steps = []
        for index, specialist in enumerate(result.get("specialist_results", []), start=1):
            step = {
                "key": f"specialist-{index}",
                "label": specialist["summary"],
                "state": "done" if specialist["status"] == "ok" else "failed",
            }
            steps.append(step)
            append_event(db, run, "step", {"step": step})
        interrupts = result.get("__interrupt__", [])
        if interrupts:
            value = getattr(interrupts[0], "value", {})
            kind = value.get("kind") if isinstance(value, dict) else None
            if kind == "clarification":
                status = "waiting_user"
                blocks = [
                    {
                        "type": "clarification",
                        "question": value["question"],
                        "options": value.get("options", []),
                    }
                ]
            elif kind == "approval":
                status = "waiting_approval"
                proposal_id = value["proposal_id"]
                proposal = db.scalar(
                    select(Proposal)
                    .where(Proposal.id == proposal_id, Proposal.actor_id == run.user_id)
                    .with_for_update()
                )
                if not proposal:
                    raise RuntimeError("Interrupted proposal is missing")
                proposal.parameters = {**proposal.parameters, "_run_id": run.id}
                blocks = [{"type": "proposal", "proposal_id": proposal_id}]
            else:
                raise RuntimeError("Unsupported LangGraph interrupt")
            message = Message(
                conversation_id=run.conversation_id,
                role="assistant",
                blocks=blocks,
                run_id=run.id,
                created_at=utcnow(),
            )
            db.add(message)
            db.flush()
            run.steps = steps
            run.checkpoint = {
                "specialist_results": result.get("specialist_results", []),
                "intent": result.get("intent"),
                "mcp_invocations": result.get("mcp_invocations", []),
                "pending_proposal_id": result.get("pending_proposal_id"),
                "tool_call_count": result.get("tool_call_count", 0),
                "llm_call_count": result.get("llm_call_count", 0),
                "tokens_input": result.get("tokens_input", 0),
                "tokens_output": result.get("tokens_output", 0),
                "estimated_cost": result.get("estimated_cost", 0.0),
                "cost_kind": "ESTIMATED",
                "active_elapsed_seconds": active_elapsed,
            }
            run.status = status
            append_event(db, run, "message", {"message_id": message.id})
            append_event(db, run, "status", {"status": status})
            return
        blocks = [{"type": "text", "markdown": result["answer"]}]
        if result.get("citations"):
            blocks.append({"type": "citations", "items": result["citations"]})
        message = Message(
            conversation_id=run.conversation_id,
            role="assistant",
            blocks=blocks,
            run_id=run.id,
            created_at=utcnow(),
        )
        db.add(message)
        db.flush()
        run.steps = steps
        run.checkpoint = {
            "specialist_results": result.get("specialist_results", []),
            "intent": result.get("intent"),
            "mcp_invocations": result.get("mcp_invocations", []),
            "pending_proposal_id": result.get("pending_proposal_id"),
            "tool_call_count": result.get("tool_call_count", 0),
            "llm_call_count": result.get("llm_call_count", 0),
            "tokens_input": result.get("tokens_input", 0),
            "tokens_output": result.get("tokens_output", 0),
            "estimated_cost": result.get("estimated_cost", 0.0),
            "cost_kind": "ESTIMATED",
            "active_elapsed_seconds": active_elapsed,
        }
        run.status = "completed"
        append_event(db, run, "message", {"message_id": message.id})
        append_event(db, run, "status", {"status": "completed"})
        conversation = db.get(Conversation, run.conversation_id)
        if conversation and conversation.active_run_id == run.id:
            conversation.active_run_id = None


def process_ingest(payload: dict[str, Any], claim: ClaimedTask) -> None:
    with SessionLocal.begin() as db:
        assert_lease(db, claim)
        job = db.scalar(select(ImportJob).where(ImportJob.id == payload["import_id"]).with_for_update())
        if not job:
            return
        edition = db.get(Edition, job.edition_id)
        publication = db.get(Publication, edition.publication_id) if edition else None
        if not edition or not publication:
            raise RuntimeError("Import target no longer exists")
        content = S3Storage(settings).read(job.object_key)
        extracted: list[tuple[str, str]] = []
        if job.media_type == "application/pdf":
            for page_number, page in enumerate(PdfReader(BytesIO(content)).pages, start=1):
                text = (page.extract_text() or "").strip()
                if text:
                    extracted.append((f"page-{page_number}", text))
            if not extracted:
                job.warnings = [*job.warnings, "OCR_REQUIRED: aucun texte extractible; aucun index IA créé."]
        else:
            text = content.decode("utf-8", errors="replace").strip()
            if text:
                extracted.append(("document", text))

        chunks: list[PassageInput] = []
        for section, text in extracted:
            for offset in range(0, len(text), 1800):
                chunk = text[offset : offset + 2000].strip()
                if chunk:
                    chunks.append(
                        PassageInput(
                            document_id=edition.id,
                            version=str(edition.version),
                            publisher_id=publication.publisher_id,
                            page_or_section=section,
                            visibility="entitled",
                            language=edition.language,
                            effective_at=edition.published_at,
                            ai_allowed=bool(edition.permissions.get("ai_indexing")),
                            text=chunk,
                        )
                    )
        provider = provider_from_settings(settings)
        if chunks and edition.permissions.get("ai_indexing") and provider.status().configured:
            RetrievalIndex(settings, provider).index(db, chunks)
        elif edition.permissions.get("ai_indexing"):
            job.warnings = [*job.warnings, "AI_INDEX_SKIPPED: fournisseur d'embeddings non configuré."]

        asset = Asset(
            edition_id=job.edition_id,
            object_key=job.object_key,
            media_type=job.media_type,
            size_bytes=job.size_bytes,
            sha256=job.object_key.rsplit("/", 1)[-1],
            status="ready",
        )
        db.add(asset)
        db.flush()
        edition.asset_id = asset.id
        edition.page_count = len(extracted) if job.media_type == "application/pdf" else None
        edition.word_count = sum(len(text.split()) for _, text in extracted)
        job.status = "ready"
        job.progress = 100
        assert_lease(db, claim)


def process_one(claim: ClaimedTask, graph: Any) -> None:
    with SessionLocal() as db:
        task = assert_lease(db, claim)
        kind, payload = task.kind, task.payload
    if kind in {"assistant_run", "assistant_resume"}:
        process_assistant(payload, graph, claim)
    elif kind == "ingest_asset":
        process_ingest(payload, claim)
    elif kind == "send_password_reset":
        with SessionLocal() as db:
            assert_lease(db, claim)
        EmailSender(settings).send_password_reset(payload["email"], payload["token"])
    else:
        raise RuntimeError(f"Unknown task kind: {kind}")


def dispatch_outbox(limit: int = 50) -> list[str]:
    """Dispatch committed local events to the worker's durable internal sink.

    External integrations must add their own idempotent handler before a topic is
    considered delivered. Current P0 topics are internal wake-up/observability events.
    """
    with SessionLocal.begin() as db:
        rows = list(
            db.scalars(
                select(OutboxEvent)
                .where(OutboxEvent.published_at.is_(None))
                .order_by(OutboxEvent.created_at)
                .with_for_update(skip_locked=True)
                .limit(limit)
            )
        )
        published_at = utcnow()
        for row in rows:
            row.published_at = published_at
        return [row.id for row in rows]


def main(once: bool = False) -> None:
    if not once:
        signal.signal(signal.SIGTERM, lambda *_: shutdown_requested.set())
        signal.signal(signal.SIGINT, lambda *_: shutdown_requested.set())
    provider = provider_from_settings(settings)
    connection = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with PostgresSaver.from_conn_string(connection) as checkpointer:
        graph = build_graph(provider, checkpointer)
        while True:
            if shutdown_requested.is_set():
                return
            dispatch_outbox()
            claim = claim_task()
            if not claim:
                if once:
                    return
                time.sleep(1)
                continue
            try:
                with lease_heartbeat(claim) as lost:
                    process_one(claim, graph)
                    if lost.is_set():
                        raise RuntimeError("TASK_LEASE_LOST")
                finish(claim)
            except Exception as error:
                fail(claim, error)
            if once:
                return


if __name__ == "__main__":
    main("--once" in sys.argv)
