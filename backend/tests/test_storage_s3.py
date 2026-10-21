import hashlib
import secrets
import time
import uuid
from datetime import datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import Asset, Edition, EditorialStatus, Entitlement, Publication, Publisher
from app.domains.storage import S3Storage
from app.main import app

pytestmark = pytest.mark.postgres


def csrf(client: TestClient) -> dict[str, str]:
    response = client.get("/v1/auth/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def register(client: TestClient, email: str | None = None) -> str:
    response = client.post(
        "/v1/auth/register",
        headers=csrf(client),
        json={
            "display_name": "S3 Reader",
            "email": email or f"s3-{uuid.uuid4()}@example.com",
            "password": "Correct-Horse-2026!",
            "accepted_terms_version": "mvp-2026-10-01",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["user"]["id"]


def test_private_asset_entitlement_presigned_expiry_refresh_and_revocation(
    database_url: str, client: TestClient
) -> None:
    settings = Settings(
        storage_endpoint="http://127.0.0.1:9090",
        storage_public_origin="http://127.0.0.1:9090",
        storage_bucket="kiosy-private",
        storage_access_key="local-s3-key",
        storage_secret_key=secrets.token_urlsafe(32),
        storage_presigned_ttl_seconds=1,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        owner_email = f"s3-owner-{uuid.uuid4()}@example.com"
        user_id = register(client, owner_email)
        suffix = uuid.uuid4().hex
        content = b"Kiosy private integration asset"
        object_key = f"integration/{suffix}.md"
        with SessionLocal.begin() as db:
            publisher = Publisher(name=f"S3 Publisher {suffix}")
            db.add(publisher)
            db.flush()
            publication = Publication(
                slug=f"s3-publication-{suffix}",
                title="Publication privée S3",
                author="Kiosy",
                publisher_id=publisher.id,
                universe="business",
                language="fr",
                summary="Test d'intégration privé",
                tags=["s3"],
                cover={},
            )
            db.add(publication)
            db.flush()
            edition = Edition(
                publication_id=publication.id,
                label="Intégration",
                published_at=utcnow(),
                format="text",
                language="fr",
                page_count=None,
                word_count=4,
                status=EditorialStatus.published,
                availability={"state": "available"},
                permissions={"read": True, "download": False},
                is_free=False,
                version=1,
            )
            db.add(edition)
            db.flush()
            asset = Asset(
                edition_id=edition.id,
                object_key=object_key,
                media_type="text/markdown",
                size_bytes=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
                status="ready",
                download_allowed=False,
            )
            db.add(asset)
            db.flush()
            edition.asset_id = asset.id
            entitlement = Entitlement(
                user_id=user_id,
                source="integration",
                source_ref=str(uuid.uuid4()),
                scope={"kind": "edition", "edition_id": edition.id},
                valid_from=utcnow(),
                valid_until=None,
                status="active",
            )
            db.add(entitlement)
            db.flush()
            asset_id = asset.id
            edition_id = edition.id
            entitlement_id = entitlement.id

        storage = S3Storage(settings)
        storage.upload(object_key, content, "text/markdown")
        assert storage.read(object_key) == content

        first = client.get(f"/v1/assets/{asset_id}/access")
        assert first.status_code == 200, first.text
        first_body = first.json()
        assert httpx.get(first_body["url"], timeout=10).content == content
        assert datetime.fromisoformat(first_body["expires_at"].replace("Z", "+00:00")) > utcnow()

        time.sleep(1.1)
        assert datetime.fromisoformat(first_body["expires_at"].replace("Z", "+00:00")) <= utcnow()
        refreshed = client.get(f"/v1/assets/{asset_id}/access")
        assert refreshed.status_code == 200
        assert refreshed.json()["url"] != first_body["url"]
        assert httpx.get(refreshed.json()["url"], timeout=10).content == content

        register(client)
        other_user = client.get(f"/v1/assets/{asset_id}/access")
        assert other_user.status_code == 403
        assert other_user.json()["code"] == "ACCESS_DENIED"

        login = client.post(
            "/v1/auth/login",
            headers=csrf(client),
            json={"email": owner_email, "password": "Correct-Horse-2026!"},
        )
        assert login.status_code == 200

        with SessionLocal.begin() as db:
            entitlement = db.get(Entitlement, entitlement_id)
            assert entitlement is not None
            entitlement.status = "revoked"

        denied = client.get(f"/v1/assets/{asset_id}/access")
        assert denied.status_code == 403
        assert denied.json()["code"] == "ACCESS_DENIED"

        with SessionLocal.begin() as db:
            entitlement = db.get(Entitlement, entitlement_id)
            edition = db.get(Edition, edition_id)
            assert entitlement is not None and edition is not None
            entitlement.status = "active"
            edition.status = EditorialStatus.suspended

        withdrawn = client.get(f"/v1/assets/{asset_id}/access")
        assert withdrawn.status_code == 404
        assert withdrawn.json()["code"] == "NOT_FOUND"
    finally:
        app.dependency_overrides.pop(get_settings, None)
