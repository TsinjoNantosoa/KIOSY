from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import ForgotInput, LoginInput, PreferencesInput, RegisterInput, ResetInput
from app.api.serializers import iso, session_out
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import (
    CSRF_BINDING_COOKIE,
    SESSION_COOKIE,
    create_session,
    csrf_token,
    current_session,
    hash_password,
    load_session,
    opaque_token,
    request_device_label,
    token_hash,
    utcnow,
    verify_password,
)
from app.db.base import get_db
from app.db.models import ContractDocumentVersion, PasswordReset, SessionRecord, User
from app.domains.commerce_service import enqueue

router = APIRouter(prefix="/v1")


def cookie_options(settings: Settings) -> dict[str, object]:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain,
        "path": "/",
    }


def set_auth_cookies(response: Response, raw_session: str, binding: str, settings: Settings) -> None:
    opts = cookie_options(settings)
    response.set_cookie(SESSION_COOKIE, raw_session, max_age=settings.session_ttl_hours * 3600, **opts)
    response.set_cookie(CSRF_BINDING_COOKIE, binding, max_age=settings.session_ttl_hours * 3600, **opts)


@router.get("/auth/csrf")
def get_csrf(
    response: Response,
    kiosy_csrf_binding: str | None = Cookie(default=None),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    binding = kiosy_csrf_binding or opaque_token()
    if not kiosy_csrf_binding:
        response.set_cookie(
            CSRF_BINDING_COOKIE,
            binding,
            max_age=settings.session_ttl_hours * 3600,
            **cookie_options(settings),
        )
    return {"token": csrf_token(binding, settings)}


@router.post("/auth/register")
def register(
    payload: RegisterInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    current_terms = db.scalar(
        select(ContractDocumentVersion).where(
            ContractDocumentVersion.document_id == "utilisation",
            ContractDocumentVersion.version == payload.accepted_terms_version,
        )
    )
    if not current_terms:
        raise DomainError(409, "TERMS_VERSION_INVALID", "Cette version des conditions n'est pas disponible.")
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise DomainError(409, "EMAIL_ALREADY_USED", "Cette adresse ne peut pas être utilisée.")
    user = User(email=email, display_name=payload.display_name, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    binding = opaque_token()
    record, raw = create_session(db, user, request_device_label(request), binding, settings)
    from app.domains.audit import record_audit

    record_audit(
        db,
        action="auth.register",
        target_type="user",
        target_id=user.id,
        result="success",
        request_id=getattr(request.state, "request_id", "unknown"),
        actor=user,
    )
    db.commit()
    set_auth_cookies(response, raw, binding, settings)
    return session_out(record, user)


@router.post("/auth/login")
def login(
    payload: LoginInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(user.password_hash, payload.password) or not user.is_active:
        raise DomainError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.")
    binding = opaque_token()
    record, raw = create_session(db, user, request_device_label(request), binding, settings)
    from app.domains.audit import record_audit

    record_audit(
        db,
        action="auth.login",
        target_type="user",
        target_id=user.id,
        result="success",
        request_id=getattr(request.state, "request_id", "unknown"),
        actor=user,
    )
    db.commit()
    set_auth_cookies(response, raw, binding, settings)
    return session_out(record, user)


@router.get("/auth/session", response_model=None)
def get_session(
    kiosy_session: str | None = Cookie(default=None), db: Session = Depends(get_db)
) -> dict | Response:
    loaded = load_session(db, kiosy_session)
    if not loaded:
        return Response(status_code=204)
    db.commit()
    return session_out(*loaded)


@router.post("/auth/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    session: tuple[SessionRecord, User] = Depends(current_session),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    session[0].revoked_at = utcnow()
    from app.domains.audit import record_audit

    record_audit(
        db,
        action="auth.logout",
        target_type="session",
        target_id=session[0].id,
        result="success",
        request_id=getattr(request.state, "request_id", "unknown"),
        actor=session[1],
    )
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", domain=settings.cookie_domain)
    response.delete_cookie(CSRF_BINDING_COOKIE, path="/", domain=settings.cookie_domain)
    response.status_code = 204
    return response


@router.get("/me/sessions")
def sessions(
    session: tuple[SessionRecord, User] = Depends(current_session), db: Session = Depends(get_db)
) -> list[dict]:
    current, user = session
    rows = db.scalars(
        select(SessionRecord).where(SessionRecord.user_id == user.id, SessionRecord.revoked_at.is_(None))
    ).all()
    return [
        {
            "id": row.id,
            "device_label": row.device_label,
            "created_at": iso(row.created_at),
            "last_seen_at": iso(row.last_seen_at),
            "current": row.id == current.id,
        }
        for row in rows
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: str,
    request: Request,
    session: tuple[SessionRecord, User] = Depends(current_session),
    db: Session = Depends(get_db),
) -> Response:
    row = db.scalar(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == session[1].id)
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Session introuvable.")
    row.revoked_at = utcnow()
    from app.domains.audit import record_audit

    record_audit(
        db,
        action="auth.session.revoked",
        target_type="session",
        target_id=row.id,
        result="success",
        request_id=getattr(request.state, "request_id", "unknown"),
        actor=session[1],
    )
    db.commit()
    return Response(status_code=204)


@router.patch("/me/preferences")
def preferences(
    payload: PreferencesInput,
    session: tuple[SessionRecord, User] = Depends(current_session),
    db: Session = Depends(get_db),
) -> dict:
    record, user = session
    values = payload.model_dump(exclude_none=True)
    if "display_name" in values:
        user.display_name = values.pop("display_name")
    user.preferences = {**user.preferences, **values}
    db.commit()
    return session_out(record, user)


@router.post("/auth/password/forgot", status_code=204)
def forgot(
    payload: ForgotInput, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> Response:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user:
        raw = opaque_token()
        db.add(
            PasswordReset(
                user_id=user.id, token_hash=token_hash(raw), expires_at=utcnow() + timedelta(minutes=30)
            )
        )
        if settings.email_mode != "disabled":
            enqueue(db, "send_password_reset", {"email": user.email, "token": raw})
        db.commit()
    return Response(status_code=204)


@router.post("/auth/password/reset", status_code=204)
def reset(payload: ResetInput, db: Session = Depends(get_db)) -> Response:
    row = db.scalar(
        select(PasswordReset).where(PasswordReset.token_hash == token_hash(payload.token)).with_for_update()
    )
    if not row or row.used_at or row.expires_at <= utcnow():
        raise DomainError(409, "RESET_TOKEN_INVALID", "Le lien est invalide ou expiré.")
    user = db.get(User, row.user_id)
    if not user:
        raise DomainError(409, "RESET_TOKEN_INVALID", "Le lien est invalide ou expiré.")
    user.password_hash = hash_password(payload.password)
    row.used_at = utcnow()
    for active in db.scalars(
        select(SessionRecord).where(SessionRecord.user_id == user.id, SessionRecord.revoked_at.is_(None))
    ):
        active.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)
