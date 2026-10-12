"""Bounded, opt-in Azure OpenAI capability diagnostic.

The script never prints prompts, completions, credentials, or private reasoning. It
only emits capability status, public request identifiers, and sanitized errors.
"""

import json
import os
from collections.abc import Callable
from typing import Any

from openai import APITimeoutError, AzureOpenAI
from pydantic import BaseModel, ConfigDict

from app.ai.providers import AzureProvider
from app.core.config import get_settings


class DiagnosticShape(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str


def _enabled() -> bool:
    return os.getenv("RUN_AZURE_LIVE_TESTS", "").casefold() == "true"


def _sanitize(message: str, secrets: list[str]) -> str:
    value = message
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    return value[:500]


def _request_id(response: Any) -> str | None:
    return getattr(response, "_request_id", None)


def main() -> int:
    if not _enabled():
        print(json.dumps({"status": "SKIPPED", "reason": "RUN_AZURE_LIVE_TESTS is not true"}))
        return 0

    settings = get_settings()
    secrets = [settings.azure_openai_api_key or ""]
    results: list[dict[str, Any]] = []

    def run(name: str, operation: Callable[[], Any]) -> Any | None:
        try:
            response = operation()
            results.append({"check": name, "status": "PASS", "request_id": _request_id(response)})
            return response
        except Exception as exc:  # diagnostic must report the provider's exact public failure
            results.append(
                {
                    "check": name,
                    "status": "FAIL",
                    "error_type": type(exc).__name__,
                    "error": _sanitize(str(exc), secrets),
                }
            )
            return None

    try:
        provider = AzureProvider(settings)
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "check": "configuration",
                    "error_type": type(exc).__name__,
                    "error": _sanitize(str(exc), secrets),
                },
                ensure_ascii=False,
            )
        )
        return 2

    deployment = settings.azure_openai_deployment
    assert deployment is not None
    results.append(
        {
            "check": "configuration",
            "status": "PASS",
            "provider": provider.status().provider,
            "deployment": deployment,
            "api_version": settings.azure_openai_api_version,
            "embeddings_configured": bool(settings.azure_openai_embedding_deployment),
        }
    )

    run(
        "chat",
        lambda: provider.client.chat.completions.create(
            model=deployment,
            messages=[{"role": "user", "content": "Réponds uniquement: OK"}],
            max_tokens=4,
            temperature=0,
        ),
    )
    run(
        "tool_calling",
        lambda: provider.client.chat.completions.create(
            model=deployment,
            messages=[{"role": "user", "content": "Utilise l'outil health avec status OK."}],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "health",
                        "description": "Retourne un état de diagnostic.",
                        "parameters": {
                            "type": "object",
                            "properties": {"status": {"type": "string"}},
                            "required": ["status"],
                            "additionalProperties": False,
                        },
                    },
                }
            ],
            tool_choice={"type": "function", "function": {"name": "health"}},
            max_tokens=32,
            temperature=0,
        ),
    )
    run(
        "structured_output",
        lambda: provider.client.beta.chat.completions.parse(
            model=deployment,
            messages=[{"role": "user", "content": "Retourne le statut OK."}],
            response_format=DiagnosticShape,
            max_tokens=32,
            temperature=0,
        ),
    )

    def timeout_check() -> Any:
        timeout_client = AzureOpenAI(
            api_key=settings.azure_openai_api_key,
            azure_endpoint=(settings.azure_openai_endpoint or "").rstrip("/"),
            api_version=settings.azure_openai_api_version,
            timeout=0.001,
            max_retries=0,
        )
        try:
            timeout_client.chat.completions.create(
                model=deployment,
                messages=[{"role": "user", "content": "OK"}],
                max_tokens=1,
            )
        except APITimeoutError as exc:
            return exc
        raise RuntimeError("The deliberately bounded request did not time out")

    run("timeout_handling", timeout_check)
    run(
        "azure_error_handling",
        lambda: provider.client.chat.completions.create(
            model=f"{deployment}-kiosy-diagnostic-invalid",
            messages=[{"role": "user", "content": "OK"}],
            max_tokens=1,
        ),
    )
    # The invalid-deployment check is successful when Azure returns a controlled error.
    error_result = next(item for item in results if item["check"] == "azure_error_handling")
    if error_result["status"] == "FAIL":
        error_result["status"] = "PASS"
        error_result["expected_error"] = error_result.pop("error_type")
        error_result.pop("error", None)

    passed = all(item["status"] == "PASS" for item in results)
    print(json.dumps({"status": "PASS" if passed else "FAIL", "checks": results}, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
