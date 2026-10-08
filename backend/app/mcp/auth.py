import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

from app.core.config import get_settings
from app.core.errors import DomainError


def issue_context(
    user_id: str, audience: str, scopes: list[str], ttl_seconds: int = 120, trace_id: str | None = None
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "iss": "kiosy-api",
        "aud": audience,
        "scopes": scopes,
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": str(uuid.uuid4()),
    }
    if trace_id:
        payload["trace_id"] = trace_id
    encoded = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
        .decode()
        .rstrip("=")
    )
    signature = hmac.new(get_settings().secret_key.encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def verify_context(token: str, audience: str, required_scope: str) -> dict[str, Any]:
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(get_settings().secret_key.encode(), encoded.encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(actual, expected):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if (
            payload.get("iss") != "kiosy-api"
            or payload["exp"] < int(time.time())
            or payload["aud"] != audience
            or required_scope not in payload["scopes"]
        ):
            raise ValueError
        return payload
    except (ValueError, KeyError, json.JSONDecodeError):
        raise DomainError(403, "MCP_CONTEXT_INVALID", "Contexte MCP invalide ou expiré.") from None
