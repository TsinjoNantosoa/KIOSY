import concurrent.futures
import secrets
from datetime import timedelta

import pytest

from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.security import hash_password, utcnow
from app.db.base import SessionLocal
from app.db.models import Offer, OfferKind, Quote, User
from app.domains.commerce_service import create_order

pytestmark = pytest.mark.postgres


def test_one_last_place_under_100_concurrent_requests(database_url: str) -> None:
    public_id = secrets.token_hex(16)
    with SessionLocal.begin() as db:
        offer = Offer(
            offer_key=public_id,
            version=1,
            kind=OfferKind.single,
            title="Dernière place concurrence",
            description="Test PostgreSQL réel",
            price_amount=1000,
            price_currency="MGA",
            price_scale=0,
            renewal="none",
            scope={"kind": "free_selection", "label": "Concurrence"},
            restrictions=[],
            conditions_version="mvp-2026-10-01",
            status="active",
            quota_total=1,
            quota_remaining=1,
        )
        db.add(offer)
        users = [User(email=f"quota-{secrets.token_hex(8)}@test.local", display_name=f"Concurrent {index}", password_hash=hash_password("Concurrent-2026!"), roles=["reader"]) for index in range(100)]
        db.add_all(users)
        db.flush()
        user_ids = [user.id for user in users]
        quote_ids = {}
        for user in users:
            quote = Quote(user_id=user.id, offer_id=offer.id, snapshot={}, total_amount=offer.price_amount, currency=offer.price_currency, scale=offer.price_scale, created_at=utcnow(), expires_at=utcnow() + timedelta(minutes=10))
            db.add(quote)
            db.flush()
            quote_ids[user.id] = quote.id

    def attempt(user_id: str) -> str:
        payload = {"quote_id": quote_ids[user_id], "offer_id": public_id, "offer_version": 1, "accepted_conditions_version": "mvp-2026-10-01", "renewal_of_subscription_id": None}
        with SessionLocal() as db:
            try:
                user = db.get(User, user_id)
                result = create_order(db, user, payload, get_settings())
                db.commit()
                return result["id"]
            except DomainError as error:
                db.rollback()
                return error.code

    with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
        results = list(executor.map(attempt, user_ids))
    winners = [result for result in results if result not in {"OFFER_SOLD_OUT", "OFFER_UNAVAILABLE"}]
    assert len(winners) == 1
    with SessionLocal() as db:
        remaining = db.query(Offer).filter(Offer.offer_key == public_id).one().quota_remaining
        assert remaining == 0
