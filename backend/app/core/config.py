import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="KIOSY_", extra="ignore")

    env: Literal["development", "test", "staging", "production"] = "development"
    database_url: str = "postgresql+psycopg://kiosy:kiosy@localhost:5432/kiosy"
    frontend_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    public_api_url: str = "http://localhost:8000"
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48), repr=False)
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None
    session_ttl_hours: int = Field(default=168, ge=1, le=744)
    csrf_ttl_minutes: int = Field(default=30, ge=5, le=120)
    quote_ttl_minutes: int = Field(default=15, ge=1, le=60)
    reservation_ttl_minutes: int = Field(default=20, ge=1, le=120)
    test_payment_enabled: bool = True
    storage_endpoint: str = "http://localhost:9000"
    storage_bucket: str = "kiosy-private"
    storage_access_key: str = ""
    storage_secret_key: str = Field(default="", repr=False)
    storage_public_origin: str = "http://localhost:9000"
    max_upload_bytes: int = Field(default=25_000_000, ge=1_000_000)
    qdrant_url: str = "http://localhost:6333"
    email_mode: Literal["mailpit", "smtp", "disabled"] = "mailpit"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = Field(default=None, repr=False)
    smtp_from: str = "Kiosy <no-reply@kiosy.example>"
    smtp_starttls: bool = False
    llm_provider: Literal["azure", "deterministic", "disabled"] = "disabled"
    azure_openai_api_key: str | None = None
    azure_openai_endpoint: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_embedding_deployment: str | None = None
    enable_live_azure: bool = False
    run_max_delegations: int = 4
    run_max_tool_calls: int = 12
    run_active_timeout_seconds: int = 120
    run_max_message_chars: int = 8_000
    mcp_allowed_hosts: list[str] = ["localhost", "127.0.0.1"]
    mcp_allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("secret_key")
    @classmethod
    def secret_is_not_placeholder_in_production(cls, value: str, info: object) -> str:
        if len(value) < 32:
            raise ValueError("secret_key must contain at least 32 characters")
        return value

    @field_validator("frontend_origins")
    @classmethod
    def exact_origins_only(cls, value: list[str]) -> list[str]:
        if not value or "*" in value:
            raise ValueError("credentialed CORS requires explicit frontend origins")
        return [origin.rstrip("/") for origin in value]

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
