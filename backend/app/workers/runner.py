import socket
import sys
import time
from datetime import timedelta
from io import BytesIO
from typing import Any

from langgraph.checkpoint.postgres import PostgresSaver
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
    Publication,
    Run,
    TaskStatus,
)
from app.domains.email import EmailSender
from app.domains.storage import S3Storage

settings = get_settings()
worker_id = f"{socket.gethostname()}:{__import__('os').getpid()}"


def claim_task() -> str | None:
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
        task.lease_owner = worker_id
        task.lease_until = now + timedelta(seconds=60)
        return task.id


def finish(task_id: str) -> None:
    with SessionLocal.begin() as db:
        task = db.get(DurableTask, task_id)
        if task:
            task.status = TaskStatus.completed
            task.lease_until = None
            if task.kind == "send_password_reset":
                task.payload = {}


def fail(task_id: str, error: Exception) -> None:
    with SessionLocal.begin() as db:
        task = db.get(DurableTask, task_id)
        if not task:
            return
        task.last_error = f"{type(error).__name__}: {str(error)[:500]}"
        task.lease_until = None
        if task.attempts >= task.max_attempts:
            task.status = TaskStatus.failed
        else:
            task.status = TaskStatus.queued
            task.available_at = utcnow() + timedelta(seconds=min(60, 2**task.attempts))


def process_assistant(payload: dict[str, Any], graph: Any) -> None:
    run_id = payload["run_id"]
    with SessionLocal.begin() as db:
        run = db.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if not run or run.status == "cancelled":
            return
        run.status = "running"
        append_event(db, run, "status", {"status": "running"})
    try:
        result = graph.invoke(
            {
                "text": payload["text"],
                "user_id": run.user_id,
                "trace_id": run.trace_id,
                "limits": run.limits or {},
                "specialist_results": [],
                "mcp_invocations": [],
                "delegations": 0,
            },
            config={"configurable": {"thread_id": run.id}},
        )
        with SessionLocal.begin() as db:
            run = db.scalar(select(Run).where(Run.id == run_id).with_for_update())
            if not run or run.status == "cancelled":
                return
            steps = []
            for index, specialist in enumerate(result.get("specialist_results", []), start=1):
                step = {"key": f"specialist-{index}", "label": specialist["summary"], "state": "done" if specialist["status"] == "ok" else "failed"}
                steps.append(step)
                append_event(db, run, "step", {"step": step})
            blocks = [{"type": "text", "markdown": result["answer"]}]
            if result.get("citations"):
                blocks.append({"type": "citations", "items": result["citations"]})
            message = Message(conversation_id=run.conversation_id, role="assistant", blocks=blocks, run_id=run.id, created_at=utcnow())
            db.add(message)
            db.flush()
            run.steps = steps
            run.checkpoint = {
                "specialist_results": result.get("specialist_results", []),
                "intent": result.get("intent"),
                "mcp_invocations": result.get("mcp_invocations", []),
            }
            run.status = "completed"
            append_event(db, run, "message", {"message_id": message.id})
            append_event(db, run, "status", {"status": "completed"})
            conversation = db.get(Conversation, run.conversation_id)
            if conversation and conversation.active_run_id == run.id:
                conversation.active_run_id = None
    except Exception as error:
        with SessionLocal.begin() as db:
            run = db.scalar(select(Run).where(Run.id == run_id).with_for_update())
            if run and run.status != "cancelled":
                run.status = "failed"
                run.error = {"code": "RUN_FAILED", "message": "L'assistant n'a pas pu terminer cette demande."}
                append_event(db, run, "error", run.error)
        raise error


def process_ingest(payload: dict[str, Any]) -> None:
    with SessionLocal.begin() as db:
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

        asset = Asset(edition_id=job.edition_id, object_key=job.object_key, media_type=job.media_type, size_bytes=job.size_bytes, sha256=job.object_key.rsplit("/", 1)[-1], status="ready")
        db.add(asset)
        db.flush()
        edition.asset_id = asset.id
        edition.page_count = len(extracted) if job.media_type == "application/pdf" else None
        edition.word_count = sum(len(text.split()) for _, text in extracted)
        job.status = "ready"
        job.progress = 100


def process_one(task_id: str, graph: Any) -> None:
    with SessionLocal() as db:
        task = db.get(DurableTask, task_id)
        if not task:
            return
        kind, payload = task.kind, task.payload
    if kind == "assistant_run":
        process_assistant(payload, graph)
    elif kind == "ingest_asset":
        process_ingest(payload)
    elif kind == "send_password_reset":
        EmailSender(settings).send_password_reset(payload["email"], payload["token"])
    else:
        raise RuntimeError(f"Unknown task kind: {kind}")


def main(once: bool = False) -> None:
    provider = provider_from_settings(settings)
    connection = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with PostgresSaver.from_conn_string(connection) as checkpointer:
        graph = build_graph(provider, checkpointer)
        while True:
            task_id = claim_task()
            if not task_id:
                if once:
                    return
                time.sleep(1)
                continue
            try:
                process_one(task_id, graph)
                finish(task_id)
            except Exception as error:
                fail(task_id, error)
            if once:
                return


if __name__ == "__main__":
    main("--once" in sys.argv)
