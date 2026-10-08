import hashlib
import uuid
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient, models
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.providers import LlmProvider
from app.api.account import active_entitlements
from app.core.config import Settings
from app.core.security import utcnow
from app.db.models import RagPassage


@dataclass(frozen=True)
class PassageInput:
    document_id: str
    version: str
    publisher_id: str | None
    page_or_section: str
    visibility: str
    language: str
    effective_at: Any
    ai_allowed: bool
    text: str


class RetrievalIndex:
    def __init__(self, settings: Settings, provider: LlmProvider, client: QdrantClient | None = None):
        self.settings = settings
        self.provider = provider
        self.client = client or QdrantClient(url=settings.qdrant_url, timeout=10)

    def _space(self) -> str:
        status = self.provider.status()
        embedding_model = (
            self.settings.azure_openai_embedding_deployment
            if status.provider == "azure-v1"
            else status.deployment or "deterministic"
        )
        return f"{self.settings.embedding_namespace_version}:{status.provider}:{embedding_model}"

    def _collection(self) -> str:
        return "kiosy_" + hashlib.sha256(self._space().encode()).hexdigest()[:16]

    def index(self, db: Session, passages: list[PassageInput]) -> int:
        if not passages:
            return 0
        vectors = self.provider.embed([item.text for item in passages])
        collection = self._collection()
        existing = {item.name for item in self.client.get_collections().collections}
        if collection not in existing:
            self.client.create_collection(
                collection,
                vectors_config=models.VectorParams(size=len(vectors[0]), distance=models.Distance.COSINE),
            )
        pending: list[tuple[RagPassage, list[float], PassageInput]] = []
        for index, (item, vector) in enumerate(zip(passages, vectors, strict=True)):
            content_hash = hashlib.sha256(item.text.encode()).hexdigest()
            row = db.scalar(
                select(RagPassage).where(
                    RagPassage.document_id == item.document_id,
                    RagPassage.version == item.version,
                    RagPassage.chunk_index == index,
                    RagPassage.embedding_space == self._space(),
                )
            )
            if not row:
                row = RagPassage(
                    document_id=item.document_id,
                    version=item.version,
                    publisher_id=item.publisher_id,
                    page_or_section=item.page_or_section,
                    visibility=item.visibility,
                    language=item.language,
                    effective_at=item.effective_at,
                    content_hash=content_hash,
                    ai_allowed=item.ai_allowed,
                    chunk_index=index,
                    text=item.text,
                    embedding_space=self._space(),
                    vector_id=str(uuid.uuid4()),
                )
                db.add(row)
            elif row.content_hash == content_hash and not row.withdrawn_at:
                continue
            else:
                row.content_hash = content_hash
                row.text = item.text
                row.withdrawn_at = None
            pending.append((row, vector, item))
        db.flush()
        points = [
            models.PointStruct(
                id=row.vector_id,
                vector=vector,
                payload={
                    "passage_id": row.id,
                    "document_id": item.document_id,
                    "version": item.version,
                    "publisher_id": item.publisher_id,
                    "visibility": item.visibility,
                    "ai_allowed": item.ai_allowed,
                },
            )
            for row, vector, item in pending
        ]
        if points:
            self.client.upsert(collection, points=points, wait=True)
        return len(points)

    def search(self, db: Session, user_id: str, query: str, limit: int = 6) -> list[RagPassage]:
        vector = self.provider.embed([query])[0]
        hits = self.client.query_points(
            self._collection(),
            query=vector,
            query_filter=models.Filter(
                must=[models.FieldCondition(key="ai_allowed", match=models.MatchValue(value=True))]
            ),
            limit=min(limit * 3, 30),
        ).points
        rights = active_entitlements(db, user_id)
        allowed_ids = []
        for hit in hits:
            row = db.get(RagPassage, hit.payload["passage_id"])
            if not row or row.withdrawn_at or not row.ai_allowed:
                continue
            if row.visibility == "public":
                allowed_ids.append(row.id)
            elif any(right.scope.get("edition_id") == row.document_id for right in rights):
                allowed_ids.append(row.id)
            if len(allowed_ids) >= limit:
                break
        if not allowed_ids:
            return []
        rows = {row.id: row for row in db.scalars(select(RagPassage).where(RagPassage.id.in_(allowed_ids)))}
        return [rows[item] for item in allowed_ids if item in rows]

    def withdraw(self, db: Session, document_id: str, version: str | None = None) -> int:
        statement = select(RagPassage).where(
            RagPassage.document_id == document_id, RagPassage.withdrawn_at.is_(None)
        )
        if version:
            statement = statement.where(RagPassage.version == version)
        rows = list(db.scalars(statement))
        ids = [row.vector_id for row in rows if row.vector_id]
        if ids:
            self.client.delete(self._collection(), points_selector=models.PointIdsList(points=ids), wait=True)
        for row in rows:
            row.withdrawn_at = utcnow()
        return len(rows)
