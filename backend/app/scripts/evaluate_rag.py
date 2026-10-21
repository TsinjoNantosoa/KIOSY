import argparse
import json
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.ai.providers import embedding_provider_from_settings
from app.ai.retrieval import RetrievalIndex
from app.core.config import get_settings
from app.db.base import SessionLocal


class RagScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    user_id: str
    query: str = Field(min_length=2)
    source_types: set[str] = Field(default_factory=lambda: {"catalog", "edition_content", "contract"})
    expected_document_ids: set[str] = Field(default_factory=set)
    forbidden_document_ids: set[str] = Field(default_factory=set)


def reciprocal_rank(ids: list[str], expected: set[str]) -> float:
    for rank, document_id in enumerate(ids, start=1):
        if document_id in expected:
            return 1.0 / rank
    return 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the live Kiosy hybrid retriever.")
    parser.add_argument("scenarios", type=Path, help="JSONL scenarios with real document and user IDs.")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    scenarios = [
        RagScenario.model_validate_json(line)
        for line in args.scenarios.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    settings = get_settings()
    index = RetrievalIndex(settings, embedding_provider_from_settings(settings))
    results: list[dict[str, Any]] = []
    with SessionLocal() as db:
        for scenario in scenarios:
            started = time.perf_counter()
            hits = index.search_with_scores(
                db,
                scenario.user_id,
                scenario.query,
                limit=args.limit,
                source_types=scenario.source_types,
            )
            ids = [hit.passage.document_id for hit in hits]
            expected_found = scenario.expected_document_ids.intersection(ids)
            leaked = scenario.forbidden_document_ids.intersection(ids)
            results.append(
                {
                    "id": scenario.id,
                    "retrieved_document_ids": ids,
                    "recall_at_k": (
                        len(expected_found) / len(scenario.expected_document_ids)
                        if scenario.expected_document_ids
                        else 1.0
                    ),
                    "reciprocal_rank": reciprocal_rank(ids, scenario.expected_document_ids),
                    "acl_leaks": sorted(leaked),
                    "latency_ms": round((time.perf_counter() - started) * 1000, 3),
                }
            )
    count = len(results)
    report = {
        "summary": {
            "executed": count,
            "mean_recall_at_k": round(sum(item["recall_at_k"] for item in results) / count, 4)
            if count
            else 0,
            "mrr": round(sum(item["reciprocal_rank"] for item in results) / count, 4)
            if count
            else 0,
            "acl_leaks": sum(len(item["acl_leaks"]) for item in results),
            "mean_latency_ms": round(sum(item["latency_ms"] for item in results) / count, 3)
            if count
            else 0,
        },
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
