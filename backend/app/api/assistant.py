import json
import time
import uuid
from collections.abc import Iterator
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas import MessageFeedbackInput, StartRunInput
from app.api.serializers import iso
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import current_user, utcnow
from app.db.base import SessionLocal, get_db
from app.db.models import Conversation, Message, MessageFeedback, OutboxEvent, Run, RunEvent, User
from app.domains.commerce_service import enqueue
from app.domains.idempotency import begin, complete

router = APIRouter(prefix="/v1")


def conversation_out(row: Conversation) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "active_run_id": row.active_run_id,
        "is_demo": row.is_demo,
    }


def message_out(row: Message) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "created_at": iso(row.created_at),
        "blocks": row.blocks,
        "run_id": row.run_id,
    }


def run_out(row: Run) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "status": row.status,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "last_seq": row.last_seq,
        "steps": row.steps,
        "error": row.error,
    }


def event_out(row: RunEvent) -> dict:
    base = {"seq": row.seq, "run_id": row.run_id, "at": iso(row.created_at), "type": row.type}
    return {**base, **row.payload}


def append_event(db: Session, run: Run, event_type: str, payload: dict) -> RunEvent:
    run.last_seq += 1
    event = RunEvent(run_id=run.id, seq=run.last_seq, type=event_type, payload=payload, created_at=utcnow())
    db.add(event)
    return event


@router.get("/conversations")
def conversations(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict]:
    return [
        conversation_out(row)
        for row in db.scalars(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.updated_at.desc())
        )
    ]


@router.post("/conversations", status_code=201)
def create_conversation(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = Conversation(user_id=user.id, title="Nouvelle conversation")
    db.add(row)
    db.commit()
    return conversation_out(row)


@router.get("/conversations/{conversation_id}")
def conversation(
    conversation_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    row = db.scalar(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Conversation introuvable.")
    return conversation_out(row)


@router.get("/conversations/{conversation_id}/messages")
def messages(
    conversation_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[dict]:
    row = db.scalar(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Conversation introuvable.")
    return [
        message_out(item)
        for item in db.scalars(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
        )
    ]


@router.post("/messages/{message_id}/feedback")
def message_feedback(
    message_id: str,
    payload: MessageFeedbackInput,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    message = db.scalar(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.id == message_id,
            Message.role == "assistant",
            Conversation.user_id == user.id,
        )
    )
    if not message:
        raise DomainError(404, "NOT_FOUND", "Réponse KIA introuvable.")
    feedback = db.scalar(
        select(MessageFeedback).where(
            MessageFeedback.message_id == message.id, MessageFeedback.user_id == user.id
        )
    )
    if feedback:
        feedback.rating = payload.rating
        feedback.reason = payload.reason.strip() if payload.reason else None
    else:
        feedback = MessageFeedback(
            message_id=message.id,
            user_id=user.id,
            rating=payload.rating,
            reason=payload.reason.strip() if payload.reason else None,
        )
        db.add(feedback)
    db.commit()
    return {"message_id": message.id, "rating": feedback.rating, "reason": feedback.reason}


@router.post("/conversations/{conversation_id}/runs", status_code=202)
def start_run(
    conversation_id: str,
    payload: StartRunInput,
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    if len(payload.text) > settings.run_max_message_chars:
        raise DomainError(422, "MESSAGE_TOO_LARGE", "Le message dépasse la taille autorisée.")
    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .with_for_update()
    )
    if not conversation:
        raise DomainError(404, "NOT_FOUND", "Conversation introuvable.")
    if conversation.active_run_id:
        active = db.get(Run, conversation.active_run_id)
        if active and active.status == "waiting_user":
            other_active_for_user = (
                db.scalar(
                    select(func.count())
                    .select_from(Run)
                    .where(
                        Run.user_id == user.id,
                        Run.id != active.id,
                        Run.status.in_({"queued", "running"}),
                    )
                )
                or 0
            )
            if other_active_for_user >= settings.run_max_active_per_user:
                raise DomainError(
                    429, "RUN_CONCURRENCY_LIMIT", "Trop de traitements sont déjà actifs pour ce compte."
                )
            active_global = (
                db.scalar(select(func.count()).select_from(Run).where(Run.status.in_({"queued", "running"})))
                or 0
            )
            if active_global >= settings.run_max_active_global:
                raise DomainError(
                    429,
                    "RUN_GLOBAL_CONCURRENCY_LIMIT",
                    "Le service traite déjà le maximum de demandes simultanées.",
                )
            operation, replay = begin(
                db,
                user.id,
                "resume_run",
                idempotency_key,
                {
                    "conversation_id": conversation_id,
                    "run_id": active.id,
                    "text_hash": __import__("hashlib").sha256(payload.text.encode()).hexdigest(),
                },
            )
            if replay is not None:
                return replay
            user_message = Message(
                conversation_id=conversation.id,
                role="user",
                blocks=[{"type": "text", "markdown": payload.text}],
                run_id=active.id,
                created_at=utcnow(),
            )
            db.add(user_message)
            db.flush()
            active.status = "queued"
            append_event(db, active, "status", {"status": "queued"})
            enqueue(db, "assistant_resume", {"run_id": active.id, "resume": {"text": payload.text}})
            result = {
                "run_id": active.id,
                "status": "queued",
                "status_url": f"/v1/runs/{active.id}",
                "user_message": message_out(user_message),
            }
            complete(operation, result, 202, "run", active.id)
            db.commit()
            return result
        if active and active.status in {"queued", "running", "waiting_approval"}:
            raise DomainError(409, "RUN_IN_PROGRESS", "Une réponse est déjà en préparation.")
    active_statuses = {"queued", "running"}
    active_for_user = (
        db.scalar(
            select(func.count())
            .select_from(Run)
            .where(Run.user_id == user.id, Run.status.in_(active_statuses))
        )
        or 0
    )
    if active_for_user >= settings.run_max_active_per_user:
        raise DomainError(
            429, "RUN_CONCURRENCY_LIMIT", "Trop de traitements sont déjà actifs pour ce compte."
        )
    active_global = (
        db.scalar(select(func.count()).select_from(Run).where(Run.status.in_(active_statuses))) or 0
    )
    if active_global >= settings.run_max_active_global:
        raise DomainError(
            429, "RUN_GLOBAL_CONCURRENCY_LIMIT", "Le service traite déjà le maximum de demandes simultanées."
        )
    period_start = utcnow() - timedelta(hours=1)
    recent_for_user = (
        db.scalar(
            select(func.count())
            .select_from(Run)
            .where(Run.user_id == user.id, Run.created_at >= period_start)
        )
        or 0
    )
    if recent_for_user >= settings.run_rate_limit_per_hour:
        raise DomainError(429, "RUN_RATE_LIMIT", "Le quota horaire de demandes KIA est atteint.")
    operation, replay = begin(
        db,
        user.id,
        "start_run",
        idempotency_key,
        {
            "conversation_id": conversation_id,
            "text_hash": __import__("hashlib").sha256(payload.text.encode()).hexdigest(),
        },
    )
    if replay is not None:
        return replay
    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        blocks=[{"type": "text", "markdown": payload.text}],
        created_at=utcnow(),
    )
    db.add(user_message)
    db.flush()
    run = Run(
        conversation_id=conversation.id,
        user_id=user.id,
        status="queued",
        limits={
            "max_delegations": settings.run_max_delegations,
            "max_tool_calls": settings.run_max_tool_calls,
            "max_llm_calls": settings.run_max_llm_calls,
            "max_estimated_tokens": settings.run_max_estimated_tokens,
            "active_timeout_seconds": settings.run_active_timeout_seconds,
        },
        trace_id=str(uuid.uuid4()),
    )
    db.add(run)
    db.flush()
    user_message.run_id = run.id
    conversation.active_run_id = run.id
    if conversation.title == "Nouvelle conversation":
        conversation.title = payload.text[:80]
    append_event(db, run, "status", {"status": "queued"})
    enqueue(db, "assistant_run", {"run_id": run.id, "text": payload.text})
    db.add(
        OutboxEvent(topic="run.queued", aggregate_id=run.id, payload={"run_id": run.id}, created_at=utcnow())
    )
    result = {
        "run_id": run.id,
        "status": "queued",
        "status_url": f"/v1/runs/{run.id}",
        "user_message": message_out(user_message),
    }
    complete(operation, result, 202, "run", run.id)
    db.commit()
    return result


def owned_run(db: Session, run_id: str, user: User) -> Run:
    row = db.get(Run, run_id)
    if not row:
        raise DomainError(404, "NOT_FOUND", "Run introuvable.")
    if row.user_id != user.id:
        raise DomainError(403, "FORBIDDEN", "Ce run appartient à un autre compte.")
    return row


@router.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    return run_out(owned_run(db, run_id, user))


@router.get("/runs/{run_id}/events")
def run_events(
    request: Request,
    run_id: str,
    after_seq: int = Query(default=0, ge=0),
    last_event_id: int | None = Header(default=None, alias="Last-Event-ID", ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    owned_run(db, run_id, user)
    cursor_start = max(after_seq, last_event_id or 0)
    if "text/event-stream" not in request.headers.get("accept", ""):
        rows = db.scalars(
            select(RunEvent)
            .where(RunEvent.run_id == run_id, RunEvent.seq > cursor_start)
            .order_by(RunEvent.seq)
            .limit(200)
        ).all()
        return [event_out(row) for row in rows]

    def stream() -> Iterator[str]:
        cursor = cursor_start
        idle = 0
        while idle < 120:
            with SessionLocal() as stream_db:
                run = stream_db.get(Run, run_id)
                rows = stream_db.scalars(
                    select(RunEvent)
                    .where(RunEvent.run_id == run_id, RunEvent.seq > cursor)
                    .order_by(RunEvent.seq)
                    .limit(100)
                ).all()
                for row in rows:
                    cursor = row.seq
                    yield f"id: {row.seq}\ndata: {json.dumps(event_out(row), ensure_ascii=False)}\n\n"
                terminal = (
                    run and run.status in {"completed", "failed", "cancelled"} and cursor >= run.last_seq
                )
            if terminal:
                break
            if not rows:
                idle += 1
                yield ": heartbeat\n\n"
                time.sleep(1)
            else:
                idle = 0

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    run = owned_run(db, run_id, user)
    if run.status not in {"completed", "failed", "cancelled"}:
        run.status = "cancelled"
        append_event(db, run, "status", {"status": "cancelled"})
        conversation = db.get(Conversation, run.conversation_id)
        if conversation and conversation.active_run_id == run.id:
            conversation.active_run_id = None
        db.commit()
    return run_out(run)
