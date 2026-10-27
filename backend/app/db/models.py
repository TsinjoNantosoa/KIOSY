import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

JsonType = JSON().with_variant(JSONB(), "postgresql")


def new_id() -> str:
    return str(uuid.uuid4())


class Role(str, enum.Enum):
    reader = "reader"
    publisher = "publisher"
    support = "support"
    manager = "manager"
    admin = "admin"
    service = "service"


class EditorialStatus(str, enum.Enum):
    draft = "draft"
    review = "review"
    changes_requested = "changes_requested"
    approved = "approved"
    published = "published"
    suspended = "suspended"
    archived = "archived"


class OfferKind(str, enum.Enum):
    free = "free"
    single = "single"
    subscription = "subscription"


class OrderStatus(str, enum.Enum):
    created = "created"
    pending_payment = "pending_payment"
    paid = "paid"
    fulfilled = "fulfilled"
    cancelled = "cancelled"
    payment_exception = "payment_exception"


class TaskStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    roles: Mapped[list[str]] = mapped_column(JsonType, default=lambda: [Role.reader.value])
    publisher_id: Mapped[str | None] = mapped_column(ForeignKey("publishers.id", ondelete="SET NULL"))
    preferences: Mapped[dict[str, Any]] = mapped_column(
        JsonType, default=lambda: {"time_zone": "UTC", "language": "fr"}
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Publisher(Base, TimestampMixin):
    __tablename__ = "publishers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class SessionRecord(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    csrf_binding_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    device_label: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Publication(Base, TimestampMixin):
    __tablename__ = "publications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(240), index=True)
    author: Mapped[str] = mapped_column(String(200))
    publisher_id: Mapped[str] = mapped_column(ForeignKey("publishers.id", ondelete="RESTRICT"), index=True)
    universe: Mapped[str] = mapped_column(String(20), index=True)
    language: Mapped[str] = mapped_column(String(8), index=True)
    summary: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JsonType, default=list)
    cover: Mapped[dict[str, Any]] = mapped_column(JsonType)
    kind: Mapped[str] = mapped_column(String(20), default="work")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Edition(Base, TimestampMixin):
    __tablename__ = "editions"
    __table_args__ = (
        UniqueConstraint("publication_id", "label"),
        CheckConstraint("version > 0", name="version_positive"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    publication_id: Mapped[str] = mapped_column(ForeignKey("publications.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(180))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    format: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(8))
    page_count: Mapped[int | None] = mapped_column(Integer)
    word_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[EditorialStatus] = mapped_column(
        Enum(EditorialStatus, name="editorial_status"), index=True
    )
    availability: Mapped[dict[str, Any]] = mapped_column(JsonType)
    permissions: Mapped[dict[str, bool]] = mapped_column(JsonType)
    is_free: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", use_alter=True, ondelete="SET NULL"))


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    edition_id: Mapped[str] = mapped_column(String(36), index=True)
    object_key: Mapped[str] = mapped_column(String(500), unique=True)
    media_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="quarantined", index=True)
    download_allowed: Mapped[bool] = mapped_column(Boolean, default=True)


class EditorialReview(Base, TimestampMixin):
    __tablename__ = "editorial_reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    edition_id: Mapped[str] = mapped_column(ForeignKey("editions.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    decision: Mapped[str] = mapped_column(String(30), index=True)
    comment: Mapped[str] = mapped_column(Text)


class Offer(Base, TimestampMixin):
    __tablename__ = "offers"
    __table_args__ = (
        UniqueConstraint("offer_key", "version"),
        CheckConstraint("price_amount >= 0", name="price_nonnegative"),
        CheckConstraint("price_scale >= 0 AND price_scale <= 6", name="scale_valid"),
        CheckConstraint("quota_total IS NULL OR quota_total >= 0", name="quota_nonnegative"),
        CheckConstraint("quota_remaining IS NULL OR quota_remaining >= 0", name="remaining_nonnegative"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    offer_key: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[OfferKind] = mapped_column(Enum(OfferKind, name="offer_kind"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text)
    price_amount: Mapped[int] = mapped_column(BigInteger)
    price_currency: Mapped[str] = mapped_column(String(3))
    price_scale: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    renewal: Mapped[str] = mapped_column(String(20), default="none")
    scope: Mapped[dict[str, Any]] = mapped_column(JsonType)
    restrictions: Mapped[list[str]] = mapped_column(JsonType, default=list)
    conditions_version: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(30), index=True)
    status_reason: Mapped[str | None] = mapped_column(Text)
    quota_total: Mapped[int | None] = mapped_column(Integer)
    quota_remaining: Mapped[int | None] = mapped_column(Integer)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class ContractDocumentVersion(Base):
    __tablename__ = "contract_document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    version: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(240))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(20), default="backend")
    sections: Mapped[list[dict[str, str]]] = mapped_column(JsonType)
    visibility: Mapped[str] = mapped_column(String(20), default="public")


class Quote(Base):
    __tablename__ = "quotes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[str] = mapped_column(String(36), index=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JsonType)
    total_amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    scale: Mapped[int] = mapped_column(Integer)
    renewal_of_subscription_id: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    reference: Mapped[str] = mapped_column(String(40), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    offer_id: Mapped[str] = mapped_column(ForeignKey("offers.id", ondelete="RESTRICT"))
    offer_snapshot: Mapped[dict[str, Any]] = mapped_column(JsonType)
    accepted_conditions_version: Mapped[str] = mapped_column(String(80))
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"), index=True)
    total_amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    scale: Mapped[int] = mapped_column(Integer)
    subscription_id: Mapped[str | None] = mapped_column(String(36))
    edition_id: Mapped[str | None] = mapped_column(String(36))
    renewal_of_subscription_id: Mapped[str | None] = mapped_column(String(36))
    receipt_available: Mapped[bool] = mapped_column(Boolean, default=False)
    exception_reason: Mapped[str | None] = mapped_column(Text)


class Reservation(Base, TimestampMixin):
    __tablename__ = "reservations"
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), primary_key=True)
    offer_id: Mapped[str] = mapped_column(ForeignKey("offers.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="reserved", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class PaymentAttempt(Base, TimestampMixin):
    __tablename__ = "payment_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(60))
    provider_session_id: Mapped[str] = mapped_column(String(160), unique=True)
    mode: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), index=True)
    expected_amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    scale: Mapped[int] = mapped_column(Integer)


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    __table_args__ = (UniqueConstraint("provider", "provider_event_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String(60))
    provider_event_id: Mapped[str] = mapped_column(String(180))
    attempt_id: Mapped[str] = mapped_column(ForeignKey("payment_attempts.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subscription(Base, TimestampMixin):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), unique=True)
    offer_snapshot: Mapped[dict[str, Any]] = mapped_column(JsonType)
    universe: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(40), index=True)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    scheduled_change: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    history: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)


class Entitlement(Base, TimestampMixin):
    __tablename__ = "entitlements"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(30))
    source_ref: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[dict[str, Any]] = mapped_column(JsonType)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)


class IdempotencyOperation(Base):
    __tablename__ = "idempotency_operations"
    __table_args__ = (UniqueConstraint("actor_id", "operation", "key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(String(36), index=True)
    operation: Mapped[str] = mapped_column(String(100))
    key: Mapped[str] = mapped_column(String(160))
    request_hash: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(20), default="processing")
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    resource_type: Mapped[str | None] = mapped_column(String(80))
    resource_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class SupportCase(Base, TimestampMixin):
    __tablename__ = "support_cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    reference: Mapped[str] = mapped_column(String(40), unique=True)
    requester_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    subject: Mapped[str] = mapped_column(String(240))
    category: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40), index=True)
    related: Mapped[dict[str, Any]] = mapped_column(JsonType)


class SupportMessage(Base):
    __tablename__ = "support_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(ForeignKey("support_cases.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    author_kind: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    active_run_id: Mapped[str | None] = mapped_column(String(36))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    blocks: Mapped[list[dict[str, Any]]] = mapped_column(JsonType)
    run_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MessageFeedback(Base, TimestampMixin):
    __tablename__ = "message_feedback"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_message_feedback_message_user"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(String(500))


class Run(Base, TimestampMixin):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)
    error: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    checkpoint: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    limits: Mapped[dict[str, Any]] = mapped_column(JsonType)
    trace_id: Mapped[str] = mapped_column(String(36), index=True)


class RunEvent(Base):
    __tablename__ = "run_events"
    __table_args__ = (UniqueConstraint("run_id", "seq"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Proposal(Base, TimestampMixin):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(240))
    resource: Mapped[dict[str, Any]] = mapped_column(JsonType)
    parameters: Mapped[dict[str, Any]] = mapped_column(JsonType)
    consequences: Mapped[list[str]] = mapped_column(JsonType)
    amount: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    conditions_version: Mapped[str | None] = mapped_column(String(80))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    approval: Mapped[str] = mapped_column(String(30))
    origin: Mapped[str] = mapped_column(String(30))
    result: Mapped[dict[str, Any] | None] = mapped_column(JsonType)


class Approval(Base, TimestampMixin):
    __tablename__ = "approvals"
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), primary_key=True)
    requested_by_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    decided_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    case_id: Mapped[str | None] = mapped_column(ForeignKey("support_cases.id", ondelete="SET NULL"))


class DurableTask(Base, TimestampMixin):
    __tablename__ = "durable_tasks"
    __table_args__ = (Index("ix_tasks_claim", "status", "available_at", "lease_until"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status"), default=TaskStatus.queued
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    lease_owner: Mapped[str | None] = mapped_column(String(100))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    topic: Mapped[str] = mapped_column(String(100), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(36), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class ImportJob(Base, TimestampMixin):
    __tablename__ = "import_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    edition_id: Mapped[str] = mapped_column(ForeignKey("editions.id", ondelete="CASCADE"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    media_type: Mapped[str] = mapped_column(String(100))
    object_key: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    warnings: Mapped[list[str]] = mapped_column(JsonType, default=list)


class RagPassage(Base, TimestampMixin):
    __tablename__ = "rag_passages"
    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "document_id",
            "version",
            "chunk_index",
            "embedding_space",
            name="uq_rag_passages_source_document_version_chunk_space",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_type: Mapped[str] = mapped_column(String(30), default="edition_content", index=True)
    document_id: Mapped[str] = mapped_column(String(36), index=True)
    publication_id: Mapped[str | None] = mapped_column(String(36), index=True)
    edition_id: Mapped[str | None] = mapped_column(String(36), index=True)
    version: Mapped[str] = mapped_column(String(80))
    publisher_id: Mapped[str | None] = mapped_column(String(36), index=True)
    page_or_section: Mapped[str] = mapped_column(String(120))
    visibility: Mapped[str] = mapped_column(String(30), index=True)
    language: Mapped[str] = mapped_column(String(8))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    content_hash: Mapped[str] = mapped_column(String(64))
    ai_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    embedding_space: Mapped[str] = mapped_column(String(160))
    vector_id: Mapped[str | None] = mapped_column(String(100))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actor_role: Mapped[str] = mapped_column(String(30))
    action: Mapped[str] = mapped_column(String(120), index=True)
    target_type: Mapped[str] = mapped_column(String(60))
    target_id: Mapped[str] = mapped_column(String(36))
    reason: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str] = mapped_column(String(30))
    request_id: Mapped[str] = mapped_column(String(80), index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
