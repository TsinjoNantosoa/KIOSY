import secrets
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="KIOSY_", extra="ignore", populate_by_name=True
    )

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
    storage_presigned_ttl_seconds: int = Field(default=300, ge=1, le=3600)
    max_upload_bytes: int = Field(default=25_000_000, ge=1_000_000)
    qdrant_url: str = "http://localhost:6333"
    email_mode: Literal["mailpit", "smtp", "disabled"] = "mailpit"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = Field(default=None, repr=False)
    smtp_from: str = "Kiosy <no-reply@kiosy.example>"
    smtp_starttls: bool = False
    llm_provider: Literal["azure", "deterministic", "disabled"] = Field(
        default="disabled",
        validation_alias=AliasChoices("LLM_PROVIDER", "KIOSY_LLM_PROVIDER"),
    )
    azure_openai_api_key: str | None = Field(
        default=None,
        repr=False,
        validation_alias=AliasChoices("AZURE_OPENAI_API_KEY", "KIOSY_AZURE_OPENAI_API_KEY"),
    )
    azure_openai_endpoint: str | None = Field(
        default=None,
        validation_alias=AliasChoices("AZURE_OPENAI_ENDPOINT", "KIOSY_AZURE_OPENAI_ENDPOINT"),
    )
    azure_openai_deployment: str | None = Field(
        default=None,
        validation_alias=AliasChoices("AZURE_OPENAI_DEPLOYMENT", "KIOSY_AZURE_OPENAI_DEPLOYMENT"),
    )
    azure_openai_api_version: str = Field(
        default="2025-01-01-preview",
        validation_alias=AliasChoices(
            "AZURE_OPENAI_API_VERSION", "KIOSY_AZURE_OPENAI_API_VERSION"
        ),
    )
    azure_openai_embedding_deployment: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
            "KIOSY_AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
        ),
    )
    embedding_namespace_version: str = "v1"
    enable_live_azure: bool = False
    run_max_delegations: int = 4
    run_max_tool_calls: int = 12
    run_max_llm_calls: int = 6
    run_active_timeout_seconds: int = 120
    run_max_message_chars: int = 8_000
    run_max_estimated_tokens: int = 12_000
    run_rate_limit_per_hour: int = 20
    run_max_active_per_user: int = 2
    run_max_active_global: int = 20
    worker_lease_seconds: int = 60
    worker_heartbeat_seconds: int = 20
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

    @field_validator("mcp_allowed_hosts")
    @classmethod
    def allow_configured_local_hosts_on_explicit_ports(cls, value: list[str]) -> list[str]:
        expanded = list(value)
        for host in value:
            if host in {"localhost", "127.0.0.1", "[::1]"} and f"{host}:*" not in expanded:
                expanded.append(f"{host}:*")
        return expanded

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def production_has_no_local_or_insecure_fallback(self) -> "Settings":
        if self.worker_heartbeat_seconds >= self.worker_lease_seconds:
            raise ValueError("worker heartbeat must be shorter than its lease")
        if self.env != "production":
            return self
        local_markers = ("localhost", "127.0.0.1", "[::1]")
        endpoints = {
            "database_url": self.database_url,
            "public_api_url": self.public_api_url,
            "storage_endpoint": self.storage_endpoint,
            "storage_public_origin": self.storage_public_origin,
            "qdrant_url": self.qdrant_url,
        }
        for name, value in endpoints.items():
            if any(marker in value.casefold() for marker in local_markers):
                raise ValueError(f"{name} cannot use a local endpoint in production")
        for name in ("public_api_url", "storage_endpoint", "storage_public_origin", "qdrant_url"):
            if not endpoints[name].startswith("https://"):
                raise ValueError(f"{name} must use HTTPS in production")
        if not self.cookie_secure or self.cookie_samesite != "none":
            raise ValueError("cross-site production cookies require Secure and SameSite=None")
        if self.test_payment_enabled:
            raise ValueError("test payment must be disabled in production")
        if any(
            any(marker in origin.casefold() for marker in local_markers) for origin in self.frontend_origins
        ):
            raise ValueError("frontend origins cannot be local in production")
        if not self.storage_access_key or not self.storage_secret_key:
            raise ValueError("production object storage credentials are required")
        if self.email_mode == "mailpit" or (
            self.email_mode == "smtp" and any(marker in self.smtp_host.casefold() for marker in local_markers)
        ):
            raise ValueError("production email cannot use a local Mailpit endpoint")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
