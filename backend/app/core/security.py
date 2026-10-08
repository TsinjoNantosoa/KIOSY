import base64
import hashlib
import hmac
import secrets
import time
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Cookie, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.db.base import get_db
from app.db.models import SessionRecord, User

SESSION_COOKIE = "kiosy_session"
CSRF_BINDING_COOKIE = "kiosy_csrf_binding"
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def utcnow() -> datetime:
    return datetime.now(UTC)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, candidate: str) -> bool:
    try:
        return password_hasher.verify(password_hash, candidate)
    except (VerificationError, InvalidHashError):
        return False


def opaque_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_token(binding: str, settings: Settings) -> str:
    expires = int(time.time()) + settings.csrf_ttl_minutes * 60
    nonce = secrets.token_urlsafe(16)
    payload = f"{expires}.{nonce}"
    signature = hmac.new(
        settings.secret_key.encode(), f"{binding}.{payload}".encode(), hashlib.sha256
    ).digest()
    return f"{payload}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def validate_csrf(token: str | None, binding: str | None, settings: Settings) -> None:
    if not token or not binding:
        raise DomainError(403, "CSRF_REQUIRED", "Le jeton anti-CSRF est absent.")
    try:
        expires_text, nonce, signature = token.split(".", 2)
        if int(expires_text) < int(time.time()):
            raise DomainError(403, "CSRF_EXPIRED", "Le jeton anti-CSRF a expiré.")
        payload = f"{expires_text}.{nonce}"
        expected = hmac.new(
            settings.secret_key.encode(), f"{binding}.{payload}".encode(), hashlib.sha256
        ).digest()
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
    except DomainError:
        raise
    except (ValueError, TypeError):
        raise DomainError(403, "CSRF_INVALID", "Le jeton anti-CSRF est invalide.") from None
    if not hmac.compare_digest(actual, expected):
        raise DomainError(403, "CSRF_INVALID", "Le jeton anti-CSRF est invalide.")


def require_csrf(
    x_csrf_token: str | None = Header(default=None),
    kiosy_csrf_binding: str | None = Cookie(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    validate_csrf(x_csrf_token, kiosy_csrf_binding, settings)


def load_session(db: Session, raw_token: str | None) -> tuple[SessionRecord, User] | None:
    if not raw_token:
        return None
    record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == token_hash(raw_token)))
    if not record or record.revoked_at or record.expires_at <= utcnow():
        return None
    user = db.get(User, record.user_id)
    if not user or not user.is_active:
        return None
    record.last_seen_at = utcnow()
    return record, user


def current_session(
    kiosy_session: str | None = Cookie(default=None), db: Session = Depends(get_db)
) -> tuple[SessionRecord, User]:
    loaded = load_session(db, kiosy_session)
    if not loaded:
        raise DomainError(401, "UNAUTHENTICATED", "Connexion requise ou session expirée.")
    return loaded


def current_user(session: tuple[SessionRecord, User] = Depends(current_session)) -> User:
    return session[1]


def optional_user(
    kiosy_session: str | None = Cookie(default=None), db: Session = Depends(get_db)
) -> User | None:
    loaded = load_session(db, kiosy_session)
    return loaded[1] if loaded else None


def require_roles(*roles: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if not set(roles).intersection(user.roles):
            raise DomainError(403, "FORBIDDEN", "Cette action n'est pas autorisée.")
        return user

    return dependency


def create_session(
    db: Session, user: User, device_label: str, csrf_binding: str, settings: Settings
) -> tuple[SessionRecord, str]:
    raw = opaque_token()
    now = utcnow()
    record = SessionRecord(
        user_id=user.id,
        token_hash=token_hash(raw),
        csrf_binding_hash=token_hash(csrf_binding),
        device_label=device_label[:200],
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(record)
    db.flush()
    return record, raw


def request_device_label(request: Request) -> str:
    value = request.headers.get("user-agent", "Navigateur")
    return value[:200]
