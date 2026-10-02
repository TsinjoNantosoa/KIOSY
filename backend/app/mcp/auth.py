import base64
import hashlib
import hmac
import json
import time
from typing import Any

from app.core.config import get_settings
from app.core.errors import DomainError


def issue_context(user_id: str, audience: str, scopes: list[str], ttl_seconds: int = 120) -> str:
    payload = {"sub": user_id, "aud": audience, "scopes": scopes, "exp": int(time.time()) + ttl_seconds}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).decode().rstrip("=")
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
        if payload["exp"] < int(time.time()) or payload["aud"] != audience or required_scope not in payload["scopes"]:
            raise ValueError
        return payload
    except (ValueError, KeyError, json.JSONDecodeError):
        raise DomainError(403, "MCP_CONTEXT_INVALID", "Contexte MCP invalide ou expiré.") from None

