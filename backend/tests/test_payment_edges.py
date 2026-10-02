import secrets

import pytest
from sqlalchemy import func, select

from app.api.commerce import process_test_outcome
from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import (
    Entitlement,
    Offer,
    OfferKind,
    Order,
    PaymentAttempt,
    PaymentEvent,
    Quote,
    Reservation,
    User,
)
from app.domains.commerce_service import checkout, create_order

pytestmark = pytest.mark.postgres


def test_duplicate_and_late_payment_never_oversell(database_url: str) -> None:
    event_id = f"late-{secrets.token_hex(8)}"
    with SessionLocal.begin() as db:
        user = User(email=f"late-{secrets.token_hex(6)}@example.com", display_name="Late payment", password_hash=hash_password("Late-Payment-2026!"), roles=["reader"])
        offer = Offer(offer_key=secrets.token_hex(16), version=1, kind=OfferKind.single, title="Late payment", description="Test", price_amount=1000, price_currency="MGA", price_scale=0, renewal="none", scope={"kind": "free_selection", "label": "Late"}, restrictions=[], conditions_version="mvp-2026-10-01", status="active", quota_total=1, quota_remaining=1)
        db.add_all([user, offer])
        db.flush()
        quote = Quote(user_id=user.id, offer_id=offer.id, snapshot={}, total_amount=1000, currency="MGA", scale=0, created_at=utcnow(), expires_at=utcnow().replace(year=utcnow().year + 1))
        db.add(quote)
        db.flush()
        result = create_order(db, user, {"quote_id": quote.id, "offer_id": offer.offer_key, "offer_version": 1, "accepted_conditions_version": "mvp-2026-10-01", "renewal_of_subscription_id": None}, get_settings())
        session = checkout(db, user, result["id"], get_settings())
        order_id = result["id"]
        session_id = session["session_id"]
        offer_id = offer.id
    with SessionLocal.begin() as db:
        reservation = db.get(Reservation, order_id)
        reservation.status = "expired"
        offer = db.get(Offer, reservation.offer_id)
        offer.quota_remaining = 1
        attempt = db.scalar(select(PaymentAttempt).where(PaymentAttempt.provider_session_id == session_id).with_for_update())
        process_test_outcome(db, attempt, "confirm", event_id)
        process_test_outcome(db, attempt, "confirm", event_id)
    with SessionLocal() as db:
        assert db.get(Order, order_id).status.value == "payment_exception"
        assert db.scalar(select(func.count()).select_from(PaymentEvent).where(PaymentEvent.provider_event_id == event_id)) == 1
        assert db.scalar(select(func.count()).select_from(Entitlement).where(Entitlement.source_ref == order_id)) == 0
        assert db.scalar(select(Offer.quota_remaining).where(Offer.id == offer_id)) == 1
