import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import Quote

pytestmark = pytest.mark.postgres


def csrf(client: TestClient) -> dict[str, str]:
    response = client.get("/v1/auth/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def register(client: TestClient) -> dict:
    headers = csrf(client)
    response = client.post(
        "/v1/auth/register",
        headers=headers,
        json={
            "display_name": "Test Reader",
            "email": f"reader-{uuid.uuid4()}@example.com",
            "password": "Correct-Horse-2026!",
            "accepted_terms_version": "mvp-2026-10-01",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_csrf_rotation_catalog_order_and_idempotency(database_url: str, client: TestClient) -> None:
    session = register(client)
    assert session["user"]["roles"] == ["reader"]
    # Login/register rotates the binding: the next mutation needs a fresh token.
    headers = csrf(client)
    catalog = client.get("/v1/publications?page_size=20").json()
    paid_offer = next(
        offer
        for item in catalog["items"]
        for offer in client.get(f"/v1/offers?publication_id={item['publication']['id']}").json()
        if offer["price"]["amount"] > 0 and offer["quota"] is None
    )
    quote = client.post("/v1/orders/quote", headers=headers, json={"offer_id": paid_offer["id"]})
    assert quote.status_code == 200
    body = {
        "quote_id": quote.json()["quote_id"],
        "offer_id": paid_offer["id"],
        "offer_version": paid_offer["version"],
        "accepted_conditions_version": paid_offer["conditions_version"],
    }
    key = str(uuid.uuid4())
    first = client.post("/v1/orders", headers={**headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201, first.text
    replay = client.post("/v1/orders", headers={**headers, "Idempotency-Key": key}, json=body)
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    mismatch = client.post(
        "/v1/orders",
        headers={**headers, "Idempotency-Key": key},
        json={**body, "accepted_conditions_version": "different"},
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["code"] == "IDEMPOTENCY_MISMATCH"


def test_cross_reader_order_access_is_hidden(database_url: str, client: TestClient) -> None:
    register(client)
    owner_headers = csrf(client)
    offer = next(
        item
        for item in client.get("/v1/offers").json()
        if item["price"]["amount"] > 0 and item["quota"] is None
    )
    quote = client.post("/v1/orders/quote", headers=owner_headers, json={"offer_id": offer["id"]}).json()
    body = {
        "quote_id": quote["quote_id"],
        "offer_id": offer["id"],
        "offer_version": offer["version"],
        "accepted_conditions_version": offer["conditions_version"],
    }
    created = client.post(
        "/v1/orders", headers={**owner_headers, "Idempotency-Key": str(uuid.uuid4())}, json=body
    )
    assert created.status_code == 201
    assert client.post("/v1/auth/logout", headers=csrf(client)).status_code == 204
    register(client)
    assert client.get(f"/v1/orders/{created.json()['id']}").status_code == 404


def test_expired_quote_and_client_price_are_rejected(database_url: str, client: TestClient) -> None:
    register(client)
    headers = csrf(client)
    offer = next(
        item
        for item in client.get("/v1/offers").json()
        if item["price"]["amount"] > 0 and item["quota"] is None
    )
    quote = client.post("/v1/orders/quote", headers=headers, json={"offer_id": offer["id"]}).json()
    base = {
        "quote_id": quote["quote_id"],
        "offer_id": offer["id"],
        "offer_version": offer["version"],
        "accepted_conditions_version": offer["conditions_version"],
    }
    tampered = client.post(
        "/v1/orders",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        json={**base, "price_amount": 1},
    )
    assert tampered.status_code == 422
    with SessionLocal.begin() as db:
        row = db.scalar(select(Quote).where(Quote.id == quote["quote_id"]).with_for_update())
        row.expires_at = utcnow()
    expired = client.post("/v1/orders", headers={**headers, "Idempotency-Key": str(uuid.uuid4())}, json=base)
    assert expired.status_code == 409
    assert expired.json()["code"] == "QUOTE_EXPIRED"
