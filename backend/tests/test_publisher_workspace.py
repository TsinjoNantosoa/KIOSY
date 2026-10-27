import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.api import admin, publisher
from app.api.schemas import EditionInput, PublicationCreateInput, PublicationInput
from app.core.errors import DomainError
from app.db.base import SessionLocal
from app.db.models import Asset, Publisher, RagPassage, User

pytestmark = pytest.mark.postgres


def _publisher_user(db, label: str) -> tuple[Publisher, User]:
    owner = Publisher(name=f"Publisher {label} {uuid.uuid4()}")
    db.add(owner)
    db.flush()
    user = User(
        email=f"publisher-{uuid.uuid4()}@example.com",
        display_name=f"Publisher {label}",
        password_hash=uuid.uuid4().hex,
        roles=["publisher"],
        publisher_id=owner.id,
        preferences={"time_zone": "UTC", "language": "fr"},
    )
    db.add(user)
    db.flush()
    return owner, user


def _payload(owner: Publisher, title: str) -> PublicationCreateInput:
    return PublicationCreateInput(
        title=title,
        author="Auteur test",
        publisher_id=owner.id,
        universe="culture",
        language="fr",
        summary="Résumé de validation du workspace éditeur.",
        tags=["phase18"],
        edition=EditionInput(
            label="Édition 1",
            format="text",
            published_at=datetime.now(UTC),
            permissions={"public_excerpt": True, "ai_indexing": True, "full_text_public": False},
            is_free=False,
        ),
    )


def test_publisher_dashboard_create_and_cross_tenant_uuid_is_hidden(database_url: str) -> None:
    with SessionLocal() as db:
        owner_a, user_a = _publisher_user(db, "A")
        owner_b, user_b = _publisher_user(db, "B")
        created_a = publisher.create_publication(_payload(owner_a, "Publication A"), db, user_a)
        created_b = publisher.create_publication(_payload(owner_b, "Publication B"), db, user_b)

        dashboard = publisher.dashboard(db, user_a)
        assert dashboard["counts"]["publications"] == 1
        assert dashboard["counts"]["drafts"] == 1
        assert publisher.analytics(db, user_a) == {
            "publications": 1,
            "editions": 1,
            "orders": 0,
            "entitlements": 0,
        }

        with pytest.raises(DomainError) as denied:
            publisher.edition(created_b["edition"]["id"], db, user_a)
        assert denied.value.status == 404

        foreign = created_b["publication"]
        with pytest.raises(DomainError) as denied_update:
            publisher.update_publication(
                foreign["id"],
                PublicationInput(
                    title=foreign["title"],
                    author=foreign["author"],
                    publisher_id=owner_b.id,
                    universe=foreign["universe"],
                    language=foreign["language"],
                    summary=foreign["summary"],
                    tags=foreign["tags"],
                ),
                db,
                user_a,
            )
        assert denied_update.value.status == 404
        assert created_a["publication"]["publisher"]["id"] == owner_a.id


def test_publisher_submission_admin_review_and_rag_gating(database_url: str) -> None:
    with SessionLocal() as db:
        owner, user = _publisher_user(db, "Workflow")
        created = publisher.create_publication(_payload(owner, "Workflow Phase 18"), db, user)
        edition_id = created["edition"]["id"]
        edition, _ = publisher._owned_edition(db, user, edition_id, lock=True)
        asset = Asset(
            edition_id=edition.id,
            object_key=f"tests/{uuid.uuid4()}",
            media_type="text/markdown",
            size_bytes=10,
            sha256="a" * 64,
            status="ready",
        )
        db.add(asset)
        db.flush()
        edition.asset_id = asset.id
        db.commit()

        submitted = publisher.submit(edition_id, {"version": 1, "reason": "Prêt"}, db, user)
        assert submitted["edition"]["status"] == "review"
        db.add(
            RagPassage(
                source_type="edition_content",
                document_id=edition_id,
                publication_id=created["publication"]["id"],
                edition_id=edition_id,
                version="1",
                publisher_id=owner.id,
                page_or_section="document",
                visibility="entitled",
                language="fr",
                effective_at=datetime.now(UTC),
                content_hash="b" * 64,
                ai_allowed=False,
                chunk_index=0,
                text="Passage privé avant validation.",
                token_count=5,
                metadata_json={},
                embedding_space="test:deterministic:phase18:8",
            )
        )
        db.commit()

        with pytest.raises(DomainError) as forbidden_publish:
            admin.transition(
                edition_id,
                {"to": "published", "version": 2, "reason": "Tentative directe"},
                db,
                user,
            )
        assert forbidden_publish.value.code == "INVALID_TRANSITION"

        admin_user = User(
            email=f"admin-{uuid.uuid4()}@example.com",
            display_name="Admin review",
            password_hash=uuid.uuid4().hex,
            roles=["admin"],
            publisher_id=None,
            preferences={"time_zone": "UTC", "language": "fr"},
        )
        db.add(admin_user)
        db.commit()
        approved = publisher.decide(
            edition_id,
            publisher.ReviewDecisionInput(decision="approved", comment="Validation éditoriale", version=2),
            db,
            admin_user,
        )
        assert approved["edition"]["status"] == "approved"
        published = admin.transition(
            edition_id,
            {"to": "published", "version": 3, "reason": "Publication validée"},
            db,
            admin_user,
        )
        assert published["edition"]["status"] == "published"

        passage = db.scalar(select(RagPassage).where(RagPassage.document_id == edition_id))
        if passage:
            assert passage.ai_allowed is True
