import secrets

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_development_fallbacks() -> None:
    storage_secret = secrets.token_urlsafe(32)
    with pytest.raises(ValidationError):
        Settings(
            env="production",
            secret_key="x" * 40,
            storage_access_key="key",
            storage_secret_key=storage_secret,
            test_payment_enabled=False,
        )


def test_production_accepts_explicit_secure_endpoints() -> None:
    storage_secret = secrets.token_urlsafe(32)
    settings = Settings(
        env="production",
        database_url="postgresql+psycopg://user:pass@db.example/kiosy",
        frontend_origins=["https://kiosy.example"],
        public_api_url="https://api.kiosy.example",
        secret_key="x" * 40,
        cookie_secure=True,
        cookie_samesite="none",
        test_payment_enabled=False,
        storage_endpoint="https://s3.example",
        storage_public_origin="https://files.example",
        storage_access_key="key",
        storage_secret_key=storage_secret,
        qdrant_url="https://qdrant.example",
        email_mode="smtp",
        smtp_host="smtp.example",
    )
    assert settings.env == "production"


def test_azure_configuration_accepts_documented_unprefixed_names(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "azure")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-only-not-a-real-key")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://resource.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-35-turbo")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
    monkeypatch.setenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "embedding-test")

    settings = Settings(_env_file=None)

    assert settings.llm_provider == "azure"
    assert settings.azure_openai_endpoint == "https://resource.openai.azure.com/"
    assert settings.azure_openai_deployment == "gpt-35-turbo"
    assert settings.azure_openai_api_version == "2025-01-01-preview"
    assert settings.azure_openai_embedding_deployment == "embedding-test"
