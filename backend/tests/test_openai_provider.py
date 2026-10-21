from types import SimpleNamespace

import app.ai.providers as providers
from app.ai.providers import OpenAIProvider, embedding_provider_from_settings, provider_from_settings
from app.core.config import Settings


class FakeResponses:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        text = "catalog" if "Classifie" in kwargs.get("instructions", "") else "Réponse KIA fondée."
        return SimpleNamespace(output_text=text)


class FakeEmbeddings:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2, 0.3])])


class FakeOpenAI:
    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs
        self.responses = FakeResponses()
        self.embeddings = FakeEmbeddings()


def settings(**updates) -> Settings:
    values = {
        "llm_provider": "openai",
        "embedding_provider": "openai",
        "openai_api_key": "test-only-not-a-real-key",
        "openai_chat_model": "gpt-test",
        "openai_embedding_model": "embed-test",
    }
    values.update(updates)
    aliases = {
        "llm_provider": "LLM_PROVIDER",
        "embedding_provider": "EMBEDDING_PROVIDER",
        "openai_api_key": "OPENAI_API_KEY",
        "openai_chat_model": "OPENAI_CHAT_MODEL",
        "openai_embedding_model": "OPENAI_EMBEDDING_MODEL",
        "openai_embedding_dimensions": "OPENAI_EMBEDDING_DIMENSIONS",
    }
    return Settings(**{aliases.get(key, key): value for key, value in values.items()}, _env_file=None)


def test_openai_provider_uses_responses_and_embeddings(monkeypatch) -> None:
    monkeypatch.setattr(providers, "OpenAI", FakeOpenAI)
    provider = OpenAIProvider(settings(openai_embedding_dimensions=256))

    assert provider.classify("une demande sans mot-clé connu") == "catalog"
    answer = provider.compose(
        "Que me conseilles-tu ?",
        ["PUBLICATION CANDIDATE: Exemple"],
        ["Utilisateur: je cherche une lecture"],
    )
    vectors = provider.embed(["contenu"])

    assert answer == "Réponse KIA fondée."
    assert vectors == [[0.1, 0.2, 0.3]]
    assert provider.client.responses.calls[-1]["model"] == "gpt-test"
    assert "Historique conversationnel" in provider.client.responses.calls[-1]["input"]
    assert provider.client.embeddings.calls[-1]["dimensions"] == 256


def test_provider_factories_can_split_generation_and_embeddings(monkeypatch) -> None:
    monkeypatch.setattr(providers, "OpenAI", FakeOpenAI)
    configured = settings(llm_provider="deterministic", embedding_provider="openai")

    assert provider_from_settings(configured).status().provider == "deterministic-test"
    embedding = embedding_provider_from_settings(configured)
    assert embedding.status().provider == "openai-responses"
    assert embedding.status().embedding_deployment == "embed-test"
