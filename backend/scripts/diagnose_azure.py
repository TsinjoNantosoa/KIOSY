import json
import sys
import time

from app.ai.providers import AzureProvider
from app.core.config import Settings
from app.core.errors import DomainError


def main() -> int:
    settings = Settings()
    report: dict[str, object] = {
        "provider": "azure-v1",
        "enabled": settings.enable_live_azure,
        "endpoint_configured": bool(settings.azure_openai_endpoint),
        "chat_deployment": settings.azure_openai_deployment,
        "embedding_deployment": settings.azure_openai_embedding_deployment,
        "checks": {},
    }
    if not settings.enable_live_azure:
        report["error"] = "LIVE_AZURE_DISABLED"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2
    try:
        provider = AzureProvider(settings)
        started = time.monotonic()
        answer = provider.client.responses.create(
            model=settings.azure_openai_deployment,
            input="Réponds uniquement par OK.",
            max_output_tokens=8,
        )
        report["checks"] = {
            "chat": {"ok": bool(answer.output_text), "duration_ms": round((time.monotonic() - started) * 1000)},
        }
        tool_response = provider.client.responses.create(
            model=settings.azure_openai_deployment,
            input="Utilise l'outil ping avec la valeur kiosy.",
            tools=[{"type": "function", "name": "ping", "description": "Diagnostic sans effet", "parameters": {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"], "additionalProperties": False}}],
            tool_choice="required",
            max_output_tokens=40,
        )
        report["checks"]["tool_call"] = {"ok": any(getattr(item, "type", "") == "function_call" for item in tool_response.output)}
        if settings.azure_openai_embedding_deployment:
            vectors = provider.embed(["diagnostic kiosy"])
            report["checks"]["embeddings"] = {"ok": bool(vectors and vectors[0]), "dimension": len(vectors[0]) if vectors else None}
        else:
            report["checks"]["embeddings"] = {"ok": False, "error": "EMBEDDING_DEPLOYMENT_MISSING"}
    except (DomainError, Exception) as error:
        report["error"] = {"type": type(error).__name__, "message": str(error)[:300]}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
