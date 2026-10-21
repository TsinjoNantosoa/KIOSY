import hashlib
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
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
    source_type: str = "edition_content"
    publication_id: str | None = None
    edition_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchHit:
    passage: RagPassage
    score: float
    dense_score: float | None
    lexical_score: float | None


def _normalized_terms(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    return [term for term in re.findall(r"[a-z0-9]{2,}", ascii_text) if term not in _STOP_WORDS]


_STOP_WORDS = {
    "alors",
    "avec",
    "cette",
    "dans",
    "des",
    "est",
    "les",
    "pour",
    "que",
    "qui",
    "une",
    "vous",
}


class RetrievalIndex:
    def __init__(self, settings: Settings, provider: LlmProvider, client: QdrantClient | None = None):
        self.settings = settings
        self.provider = provider
        self.client = client or QdrantClient(url=settings.qdrant_url, timeout=10)

    def _space(self) -> str:
        status = self.provider.status()
        embedding_model = status.embedding_deployment
        if not embedding_model and status.provider.startswith("azure"):
            embedding_model = self.settings.azure_openai_embedding_deployment
        embedding_model = embedding_model or "unconfigured"
        dimensions = self.settings.openai_embedding_dimensions or "default"
        return (
            f"{self.settings.embedding_namespace_version}:{status.provider}:"
            f"{embedding_model}:{dimensions}"
        )

    def _collection(self, source_type: str = "edition_content") -> str:
        identity = f"{self._space()}:{source_type}"
        return "kiosy_" + hashlib.sha256(identity.encode()).hexdigest()[:20]

    def _collections(self) -> set[str]:
        return {item.name for item in self.client.get_collections().collections}

    def _ensure_collection(self, source_type: str, vector_size: int) -> str:
        collection = self._collection(source_type)
        if collection not in self._collections():
            self.client.create_collection(
                collection,
                vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
            )
        return collection

    def index(self, db: Session, passages: list[PassageInput], *, force: bool = False) -> int:
        if not passages:
            return 0
        if not self.provider.status().embeddings_configured:
            raise RuntimeError("Embedding provider is not configured")
        vectors = self.provider.embed([item.text for item in passages])
        grouped: dict[str, list[tuple[RagPassage, list[float], PassageInput]]] = {}
        for chunk_index, (item, vector) in enumerate(zip(passages, vectors, strict=True)):
            content_hash = hashlib.sha256(item.text.encode()).hexdigest()
            row = db.scalar(
                select(RagPassage).where(
                    RagPassage.source_type == item.source_type,
                    RagPassage.document_id == item.document_id,
                    RagPassage.version == item.version,
                    RagPassage.chunk_index == chunk_index,
                    RagPassage.embedding_space == self._space(),
                )
            )
            vector_id = str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"kiosy:{self._space()}:{item.source_type}:{item.document_id}:{item.version}:{chunk_index}",
                )
            )
            unchanged = bool(row and row.content_hash == content_hash and not row.withdrawn_at)
            if not row:
                row = RagPassage(
                    source_type=item.source_type,
                    document_id=item.document_id,
                    publication_id=item.publication_id,
                    edition_id=item.edition_id,
                    version=item.version,
                    publisher_id=item.publisher_id,
                    page_or_section=item.page_or_section,
                    visibility=item.visibility,
                    language=item.language,
                    effective_at=item.effective_at,
                    content_hash=content_hash,
                    ai_allowed=item.ai_allowed,
                    chunk_index=chunk_index,
                    text=item.text,
                    token_count=max(1, len(item.text) // 4),
                    metadata_json=item.metadata,
                    embedding_space=self._space(),
                    vector_id=vector_id,
                )
                db.add(row)
            else:
                row.source_type = item.source_type
                row.publication_id = item.publication_id
                row.edition_id = item.edition_id
                row.publisher_id = item.publisher_id
                row.page_or_section = item.page_or_section
                row.visibility = item.visibility
                row.language = item.language
                row.effective_at = item.effective_at
                row.content_hash = content_hash
                row.ai_allowed = item.ai_allowed
                row.text = item.text
                row.token_count = max(1, len(item.text) // 4)
                row.metadata_json = item.metadata
                row.embedding_space = self._space()
                row.vector_id = vector_id
                row.withdrawn_at = None
            if unchanged and not force:
                continue
            grouped.setdefault(item.source_type, []).append((row, vector, item))
        db.flush()
        indexed = 0
        for source_type, pending in grouped.items():
            collection = self._ensure_collection(source_type, len(pending[0][1]))
            points = [
                models.PointStruct(
                    id=row.vector_id,
                    vector=vector,
                    payload={
                        "passage_id": row.id,
                        "source_type": item.source_type,
                        "document_id": item.document_id,
                        "publication_id": item.publication_id,
                        "edition_id": item.edition_id,
                        "version": item.version,
                        "publisher_id": item.publisher_id,
                        "visibility": item.visibility,
                        "language": item.language,
                        "ai_allowed": item.ai_allowed,
                        **{
                            key: value
                            for key, value in item.metadata.items()
                            if isinstance(value, str | int | float | bool) or value is None
                        },
                    },
                )
                for row, vector, item in pending
            ]
            self.client.upsert(collection, points=points, wait=True)
            indexed += len(points)
        return indexed

    def _rights(self, db: Session, user_id: str) -> tuple[set[str], set[str]]:
        edition_ids: set[str] = set()
        universes: set[str] = set()
        for right in active_entitlements(db, user_id):
            if edition_id := right.scope.get("edition_id"):
                edition_ids.add(str(edition_id))
            if universe := right.scope.get("universe"):
                universes.add(str(universe))
        return edition_ids, universes

    @staticmethod
    def _allowed(row: RagPassage, edition_ids: set[str], universes: set[str]) -> bool:
        if row.visibility == "public":
            return True
        if row.edition_id and row.edition_id in edition_ids:
            return True
        if row.document_id in edition_ids:
            return True
        return bool(row.metadata_json.get("universe") in universes)

    def _qdrant_filter(
        self, source_type: str, edition_ids: set[str], universes: set[str]
    ) -> models.Filter:
        allowed: list[models.Condition] = [
            models.FieldCondition(key="visibility", match=models.MatchValue(value="public"))
        ]
        if edition_ids:
            allowed.extend(
                [
                    models.FieldCondition(
                        key="edition_id", match=models.MatchAny(any=sorted(edition_ids))
                    ),
                    models.FieldCondition(
                        key="document_id", match=models.MatchAny(any=sorted(edition_ids))
                    ),
                ]
            )
        if universes:
            allowed.append(
                models.FieldCondition(key="universe", match=models.MatchAny(any=sorted(universes)))
            )
        return models.Filter(
            must=[
                models.FieldCondition(key="ai_allowed", match=models.MatchValue(value=True)),
                models.FieldCondition(key="source_type", match=models.MatchValue(value=source_type)),
            ],
            should=allowed,
        )

    def search_with_scores(
        self,
        db: Session,
        user_id: str,
        query: str,
        limit: int | None = None,
        source_types: set[str] | None = None,
    ) -> list[SearchHit]:
        limit = min(limit or self.settings.rag_context_limit, self.settings.rag_context_limit)
        source_types = source_types or {"edition_content", "contract"}
        edition_ids, universes = self._rights(db, user_id)
        collections = self._collections()
        vector = self.provider.embed([query])[0]
        dense: list[tuple[str, float]] = []
        for source_type in sorted(source_types):
            collection = self._collection(source_type)
            if collection not in collections:
                continue
            hits = self.client.query_points(
                collection,
                query=vector,
                query_filter=self._qdrant_filter(source_type, edition_ids, universes),
                limit=self.settings.rag_candidate_limit,
                score_threshold=self.settings.rag_score_threshold,
            ).points
            dense.extend(
                (str(hit.payload["passage_id"]), float(hit.score))
                for hit in hits
                if hit.payload and hit.payload.get("passage_id")
            )

        terms = _normalized_terms(query)
        statement = select(RagPassage).where(
            RagPassage.embedding_space == self._space(),
            RagPassage.source_type.in_(source_types),
            RagPassage.withdrawn_at.is_(None),
            RagPassage.ai_allowed.is_(True),
        )
        candidates = list(db.scalars(statement.limit(500)))
        lexical: list[tuple[str, float]] = []
        for row in candidates:
            if not self._allowed(row, edition_ids, universes):
                continue
            normalized = " ".join(_normalized_terms(row.text))
            matches = sum(1 for term in terms if term in normalized)
            if matches:
                lexical.append((row.id, matches / max(1, len(terms))))
        lexical.sort(key=lambda item: item[1], reverse=True)
        lexical = lexical[: self.settings.rag_candidate_limit]

        fused: dict[str, float] = {}
        dense_scores = dict(dense)
        lexical_scores = dict(lexical)
        for rank, (passage_id, _) in enumerate(dense, start=1):
            fused[passage_id] = fused.get(passage_id, 0.0) + self.settings.rag_dense_weight / (
                60 + rank
            )
        for rank, (passage_id, _) in enumerate(lexical, start=1):
            fused[passage_id] = fused.get(passage_id, 0.0) + self.settings.rag_lexical_weight / (
                60 + rank
            )
        ordered_ids = [item[0] for item in sorted(fused.items(), key=lambda item: item[1], reverse=True)]
        if not ordered_ids:
            return []
        rows = {
            row.id: row
            for row in db.scalars(select(RagPassage).where(RagPassage.id.in_(ordered_ids)))
        }
        result: list[SearchHit] = []
        seen_documents: dict[str, int] = {}
        for passage_id in ordered_ids:
            row = rows.get(passage_id)
            if not row or not self._allowed(row, edition_ids, universes):
                continue
            if seen_documents.get(row.document_id, 0) >= 2:
                continue
            seen_documents[row.document_id] = seen_documents.get(row.document_id, 0) + 1
            result.append(
                SearchHit(
                    passage=row,
                    score=fused[passage_id],
                    dense_score=dense_scores.get(passage_id),
                    lexical_score=lexical_scores.get(passage_id),
                )
            )
            if len(result) >= limit:
                break
        return result

    def search(
        self, db: Session, user_id: str, query: str, limit: int = 6
    ) -> list[RagPassage]:
        return [hit.passage for hit in self.search_with_scores(db, user_id, query, limit)]

    def withdraw(self, db: Session, document_id: str, version: str | None = None) -> int:
        statement = select(RagPassage).where(
            RagPassage.document_id == document_id, RagPassage.withdrawn_at.is_(None)
        )
        if version:
            statement = statement.where(RagPassage.version == version)
        rows = list(db.scalars(statement))
        collections = self._collections()
        grouped: dict[str, list[str]] = {}
        for row in rows:
            if row.vector_id:
                grouped.setdefault(row.source_type, []).append(row.vector_id)
        for source_type, ids in grouped.items():
            collection = self._collection(source_type)
            if collection in collections:
                self.client.delete(
                    collection, points_selector=models.PointIdsList(points=ids), wait=True
                )
        for row in rows:
            row.withdrawn_at = utcnow()
        return len(rows)

    def health(self, db: Session) -> dict[str, Any]:
        expected = {
            source_type: self._collection(source_type)
            for source_type in ("catalog", "edition_content", "contract")
        }
        available = self._collections()
        db_rows = list(
            db.scalars(
                select(RagPassage).where(
                    RagPassage.embedding_space == self._space(), RagPassage.withdrawn_at.is_(None)
                )
            )
        )
        counts: dict[str, int] = {}
        for row in db_rows:
            counts[row.source_type] = counts.get(row.source_type, 0) + 1
        qdrant_counts: dict[str, int] = {}
        for source_type, name in expected.items():
            if name in available:
                qdrant_counts[source_type] = int(self.client.count(name, exact=True).count)
        missing_collections = [source for source, name in expected.items() if name not in available]
        return {
            "status": "healthy" if not missing_collections and sum(counts.values()) else "degraded",
            "embedding_space": self._space(),
            "provider": self.provider.status().model_dump(),
            "database_passages": counts,
            "qdrant_points": qdrant_counts,
            "missing_collections": missing_collections,
        }
