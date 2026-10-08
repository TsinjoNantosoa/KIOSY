import secrets
import uuid
from datetime import timedelta

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from sqlalchemy import select

from app.ai.orchestration import build_graph
from app.ai.providers import DeterministicProvider
from app.api.account import library
from app.api.admin import transition
from app.api.commerce import process_test_outcome
from app.api.proposals import decide
from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import (
    Edition,
    EditorialStatus,
    Entitlement,
    Offer,
    OfferKind,
    Order,
    OrderStatus,
    PaymentAttempt,
    Proposal,
    Publication,
    Publisher,
    Quote,
    RagPassage,
    Subscription,
    SupportCase,
    User,
)
from app.domains.catalog_service import catalog
from app.domains.commerce_service import checkout, create_order

pytestmark = pytest.mark.postgres


def _catalog_fixture(db, *, suffix: str) -> tuple[Publisher, Publication, Edition]:
    publisher = Publisher(name=f"P0 Publisher {suffix}")
    db.add(publisher)
    db.flush()
    publication = Publication(
        slug=f"p0-{suffix}",
        title=f"Publication P0 {suffix}",
        author="Kiosy",
        publisher_id=publisher.id,
        universe="business",
        language="fr",
        summary="Publication de recette",
        tags=["p0"],
        cover={"kind": "gradient"},
    )
    db.add(publication)
    db.flush()
    edition = Edition(
        publication_id=publication.id,
        label="Édition P0",
        published_at=utcnow(),
        format="text",
        language="fr",
        status=EditorialStatus.published,
        availability={"state": "available"},
        permissions={"public_excerpt": False, "ai_indexing": True},
        is_free=False,
        version=1,
    )
    db.add(edition)
    db.flush()
    return publisher, publication, edition


def test_t02_paid_order_payment_entitlement_and_library(database_url: str) -> None:
    suffix = secrets.token_hex(6)
    with SessionLocal.begin() as db:
        _, _, edition = _catalog_fixture(db, suffix=suffix)
        user = User(
            email=f"p0-purchase-{suffix}@example.com",
            display_name="P0 Purchase",
            password_hash=hash_password("P0-Purchase-2026!"),
            roles=["reader"],
        )
        offer = Offer(
            offer_key=str(uuid.uuid4()),
            version=1,
            kind=OfferKind.single,
            title="Achat P0",
            description="Flux complet",
            price_amount=1200,
            price_currency="MGA",
            price_scale=0,
            renewal="none",
            scope={"kind": "edition", "edition_id": edition.id},
            restrictions=[],
            conditions_version="mvp-2026-10-01",
            status="active",
        )
        db.add_all([user, offer])
        db.flush()
        quote = Quote(
            user_id=user.id,
            offer_id=offer.id,
            snapshot={},
            total_amount=offer.price_amount,
            currency="MGA",
            scale=0,
            created_at=utcnow(),
            expires_at=utcnow() + timedelta(minutes=15),
        )
        db.add(quote)
        db.flush()
        order = create_order(
            db,
            user,
            {
                "quote_id": quote.id,
                "offer_id": offer.offer_key,
                "offer_version": 1,
                "accepted_conditions_version": offer.conditions_version,
                "renewal_of_subscription_id": None,
            },
            get_settings(),
        )
        payment = checkout(db, user, order["id"], get_settings())
        attempt = db.scalar(
            select(PaymentAttempt).where(PaymentAttempt.provider_session_id == payment["session_id"])
        )
        process_test_outcome(db, attempt, "confirm", f"p0-{suffix}")
        order_id, user_id, edition_id = order["id"], user.id, edition.id

    with SessionLocal() as db:
        user = db.get(User, user_id)
        assert db.get(Order, order_id).status == OrderStatus.fulfilled
        assert db.scalar(select(Entitlement).where(Entitlement.source_ref == order_id)) is not None
        assert edition_id in {item["edition"]["id"] for item in library(db, user)}


def test_t11_cancellation_keeps_history_and_period_end(database_url: str) -> None:
    suffix = secrets.token_hex(6)
    period_end = utcnow() + timedelta(days=20)
    with SessionLocal.begin() as db:
        user = User(
            email=f"p0-cancel-{suffix}@example.com",
            display_name="P0 Cancel",
            password_hash=hash_password("P0-Cancel-2026!"),
            roles=["reader"],
        )
        offer = Offer(
            offer_key=str(uuid.uuid4()),
            version=1,
            kind=OfferKind.subscription,
            title="Abonnement P0",
            description="Résiliation",
            price_amount=5000,
            price_currency="MGA",
            price_scale=0,
            duration={"count": 1, "unit": "month"},
            renewal="manual",
            scope={"kind": "collection", "universe": "business"},
            restrictions=[],
            conditions_version="mvp-2026-10-01",
            status="active",
        )
        db.add_all([user, offer])
        db.flush()
        order = Order(
            reference=f"P0-{suffix}",
            user_id=user.id,
            offer_id=offer.id,
            offer_snapshot={"title": offer.title, "kind": "subscription"},
            accepted_conditions_version=offer.conditions_version,
            status=OrderStatus.fulfilled,
            total_amount=offer.price_amount,
            currency="MGA",
            scale=0,
        )
        db.add(order)
        db.flush()
        subscription = Subscription(
            user_id=user.id,
            order_id=order.id,
            offer_snapshot={"title": offer.title},
            universe="business",
            status="active",
            current_period_start=utcnow(),
            current_period_end=period_end,
            cancel_at_period_end=False,
            history=[{"at": utcnow().isoformat(), "label": "Abonnement activé"}],
        )
        entitlement = Entitlement(
            user_id=user.id,
            source="subscription",
            source_ref=order.id,
            scope={"kind": "collection", "universe": "business"},
            valid_from=utcnow(),
            valid_until=period_end,
            status="active",
        )
        db.add_all([subscription, entitlement])
        db.flush()
        proposal = Proposal(
            actor_id=user.id,
            type="cancel_subscription",
            status="pending",
            title="Résilier",
            resource={"type": "subscription", "id": subscription.id, "label": offer.title, "version": 1},
            parameters={},
            consequences=[],
            expires_at=utcnow() + timedelta(minutes=15),
            approval="self",
            origin="test",
        )
        db.add(proposal)
        db.flush()
        proposal_id, subscription_id, entitlement_id, user_id = (
            proposal.id,
            subscription.id,
            entitlement.id,
            user.id,
        )

    with SessionLocal() as db:
        decide(proposal_id, "confirm", f"cancel-{suffix}", db, db.get(User, user_id), get_settings())
    with SessionLocal() as db:
        subscription = db.get(Subscription, subscription_id)
        entitlement = db.get(Entitlement, entitlement_id)
        assert subscription.cancel_at_period_end is True
        assert subscription.status == "active"
        assert subscription.history[-1]["label"] == "Résiliation programmée"
        assert entitlement.status == "active" and entitlement.valid_until == period_end


def test_t12_withdrawal_stops_sale_catalog_and_rag(database_url: str) -> None:
    suffix = secrets.token_hex(6)
    with SessionLocal.begin() as db:
        publisher, publication, edition = _catalog_fixture(db, suffix=suffix)
        admin = User(
            email=f"p0-admin-{suffix}@example.com",
            display_name="P0 Admin",
            password_hash=hash_password("P0-Admin-2026!"),
            roles=["admin"],
        )
        offer = Offer(
            offer_key=str(uuid.uuid4()),
            version=1,
            kind=OfferKind.single,
            title="Retrait P0",
            description="Retrait",
            price_amount=1000,
            price_currency="MGA",
            price_scale=0,
            renewal="none",
            scope={"kind": "edition", "edition_id": edition.id},
            restrictions=[],
            conditions_version="mvp-2026-10-01",
            status="active",
        )
        passage = RagPassage(
            document_id=edition.id,
            version="1",
            publisher_id=publisher.id,
            page_or_section="p1",
            visibility="entitled",
            language="fr",
            effective_at=utcnow(),
            content_hash="a" * 64,
            ai_allowed=True,
            chunk_index=0,
            text="contenu retiré",
            embedding_space="test",
            vector_id=str(uuid.uuid4()),
        )
        db.add_all([admin, offer, passage])
        db.flush()
        ids = edition.id, publication.id, offer.id, passage.id, admin.id

    with SessionLocal() as db:
        transition(
            ids[0], {"to": "suspended", "version": 1, "reason": "Retrait P0"}, db, db.get(User, ids[4])
        )
    with SessionLocal() as db:
        assert db.get(Offer, ids[2]).status == "inactive"
        assert db.get(RagPassage, ids[3]).withdrawn_at is not None
        result = catalog(
            db,
            q=None,
            universe=None,
            language=None,
            format=None,
            price=None,
            sort="recent",
            page=1,
            page_size=50,
        )
        assert ids[1] not in {item["publication"]["id"] for item in result["items"]}


def test_demo_support_diagnosis_creates_requested_ticket(database_url: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
        before = len(list(db.scalars(select(SupportCase).where(SupportCase.requester_id == user.id))))
        user_id = user.id
    result = build_graph(DeterministicProvider()).invoke(
        {
            "text": "J'ai payé mais je n'arrive pas à ouvrir le document. Ouvre un ticket.",
            "user_id": user_id,
            "trace_id": f"support-e2e-{uuid.uuid4()}",
            "limits": {"max_delegations": 4, "max_tool_calls": 12, "max_llm_calls": 6},
            "specialist_results": [],
            "mcp_invocations": [],
            "delegations": 0,
            "tool_call_count": 0,
            "llm_call_count": 0,
            "tokens_input": 0,
            "tokens_output": 0,
        }
    )
    assert result["intent"] == "support"
    assert result["support_case"]["reference"].startswith("SUP-")
    assert "create_support_case" in {item["tool"] for item in result["mcp_invocations"]}
    with SessionLocal() as db:
        after = len(list(db.scalars(select(SupportCase).where(SupportCase.requester_id == user_id))))
        assert after == before + 1


def test_demo_subscription_cancellation_waits_for_approval_and_resumes(database_url: str) -> None:
    suffix = secrets.token_hex(6)
    with SessionLocal.begin() as db:
        user = User(
            email=f"cancel-e2e-{suffix}@example.com",
            display_name="Cancel E2E",
            password_hash=hash_password("Cancel-E2E-2026!"),
            roles=["reader"],
        )
        offer = Offer(
            offer_key=str(uuid.uuid4()),
            version=1,
            kind=OfferKind.subscription,
            title="E2E subscription",
            description="E2E",
            price_amount=1000,
            price_currency="MGA",
            price_scale=0,
            duration={"count": 1, "unit": "month"},
            renewal="manual",
            scope={"kind": "collection", "universe": "business"},
            restrictions=[],
            conditions_version="mvp-2026-10-01",
            status="active",
        )
        db.add_all([user, offer])
        db.flush()
        order = Order(
            reference=f"E2E-{suffix}",
            user_id=user.id,
            offer_id=offer.id,
            offer_snapshot={"title": offer.title, "kind": "subscription"},
            accepted_conditions_version=offer.conditions_version,
            status=OrderStatus.fulfilled,
            total_amount=1000,
            currency="MGA",
            scale=0,
        )
        db.add(order)
        db.flush()
        subscription = Subscription(
            user_id=user.id,
            order_id=order.id,
            offer_snapshot={"title": offer.title},
            universe="business",
            status="active",
            current_period_start=utcnow(),
            current_period_end=utcnow() + timedelta(days=30),
            cancel_at_period_end=False,
            history=[],
        )
        db.add(subscription)
        db.flush()
        user_id, subscription_id = user.id, subscription.id

    graph = build_graph(DeterministicProvider(), InMemorySaver())
    config = {"configurable": {"thread_id": f"cancel-{suffix}"}}
    first = graph.invoke(
        {
            "text": "Je veux arrêter mon abonnement.",
            "user_id": user_id,
            "trace_id": f"cancel-{suffix}",
            "limits": {"max_delegations": 4, "max_tool_calls": 12, "max_llm_calls": 6},
            "specialist_results": [],
            "mcp_invocations": [],
            "delegations": 0,
            "tool_call_count": 0,
            "llm_call_count": 0,
            "tokens_input": 0,
            "tokens_output": 0,
        },
        config=config,
    )
    proposal_id = first["__interrupt__"][0].value["proposal_id"]
    with SessionLocal() as db:
        decide(proposal_id, "confirm", f"cancel-confirm-{suffix}", db, db.get(User, user_id), get_settings())
    completed = graph.invoke(
        Command(resume={"decision": "confirmed", "proposal_id": proposal_id}), config=config
    )
    assert completed["workflow_status"] == "completed"
    with SessionLocal() as db:
        assert db.get(Subscription, subscription_id).cancel_at_period_end is True
