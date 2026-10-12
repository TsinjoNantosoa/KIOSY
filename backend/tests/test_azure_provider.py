from types import SimpleNamespace

from app.ai import providers
from app.core.config import Settings


def test_azure_provider_uses_requested_endpoint_version_and_chat_deployment(monkeypatch) -> None:
    captured: dict[str, object] = {}
    calls: list[dict[str, object]] = []

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="catalog"))]
            )

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    def fake_client(**kwargs):
        captured.update(kwargs)
        return FakeClient()

    monkeypatch.setattr(providers, "AzureOpenAI", fake_client)
    settings = Settings(
        _env_file=None,
        llm_provider="azure",
        enable_live_azure=True,
        azure_openai_api_key="test-only-not-a-real-key",
        azure_openai_endpoint="https://h4h-openai.openai.azure.com/",
        azure_openai_deployment="gpt-35-turbo",
        azure_openai_api_version="2025-01-01-preview",
    )

    provider = providers.AzureProvider(settings)

    assert captured["azure_endpoint"] == "https://h4h-openai.openai.azure.com"
    assert captured["api_version"] == "2025-01-01-preview"
    assert provider.status().deployment == "gpt-35-turbo"
    assert provider.classify("publication business") == "catalog"
    assert calls[0]["model"] == "gpt-35-turbo"
