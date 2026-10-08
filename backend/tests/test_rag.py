import secrets

import pytest
from qdrant_client import QdrantClient

from app.ai.providers import DeterministicProvider, ProviderStatus
from app.ai.retrieval import PassageInput, RetrievalIndex
from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import Entitlement, User

pytestmark = pytest.mark.postgres


def passage(document_id: str, visibility: str, text: str) -> PassageInput:
    return PassageInput(
        document_id=document_id,
        version="1",
        publisher_id=None,
        page_or_section="section-1",
        visibility=visibility,
        language="fr",
        effective_at=utcnow(),
        ai_allowed=True,
        text=text,
    )


def test_rag_revalidates_acl_and_withdraws_content(database_url: str) -> None:
    index = RetrievalIndex(get_settings(), DeterministicProvider(), QdrantClient(":memory:"))
    private_id = f"edition-{secrets.token_hex(6)}"
    public_id = f"public-{secrets.token_hex(6)}"
    with SessionLocal.begin() as db:
        user = User(
            email=f"rag-{secrets.token_hex(6)}@example.com",
            display_name="RAG reader",
            password_hash=hash_password("Rag-Reader-2026!"),
            roles=["reader"],
        )
        db.add(user)
        db.flush()
        user_id = user.id
        assert (
            index.index(
                db,
                [
                    passage(private_id, "entitled", "contenu privé kiosy"),
                    passage(public_id, "public", "notice publique kiosy"),
                ],
            )
            == 2
        )
    with SessionLocal() as db:
        without_right = index.search(db, user_id, "kiosy", limit=10)
        assert {row.document_id for row in without_right} == {public_id}
    with SessionLocal.begin() as db:
        db.add(
            Entitlement(
                user_id=user_id,
                source="purchase",
                source_ref=secrets.token_hex(16),
                scope={"kind": "edition", "edition_id": private_id},
                valid_from=utcnow(),
                valid_until=None,
                status="active",
            )
        )
    with SessionLocal() as db:
        with_right = index.search(db, user_id, "kiosy", limit=10)
        assert {row.document_id for row in with_right} == {public_id, private_id}
    with SessionLocal.begin() as db:
        assert index.withdraw(db, private_id) == 1
    with SessionLocal() as db:
        after_withdrawal = index.search(db, user_id, "kiosy", limit=10)
        assert {row.document_id for row in after_withdrawal} == {public_id}


class AzureLikeEmbeddingProvider(DeterministicProvider):
    def status(self) -> ProviderStatus:
        return ProviderStatus(configured=True, provider="azure-v1", deployment="generation-model")


def test_embedding_deployment_has_a_distinct_namespace(database_url: str) -> None:
    base = get_settings()
    first = RetrievalIndex(
        base.model_copy(update={"azure_openai_embedding_deployment": "embed-a"}),
        AzureLikeEmbeddingProvider(),
        QdrantClient(":memory:"),
    )
    second = RetrievalIndex(
        base.model_copy(update={"azure_openai_embedding_deployment": "embed-b"}),
        AzureLikeEmbeddingProvider(),
        QdrantClient(":memory:"),
    )
    assert first._space() != second._space()
    assert first._collection() != second._collection()
