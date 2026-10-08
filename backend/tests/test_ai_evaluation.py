from pathlib import Path

import pytest
from sqlalchemy import select

from app.ai.evaluation import EXPECTED_DISTRIBUTION, evaluate_scenario, load_scenarios, summarize
from app.db.base import SessionLocal
from app.db.models import User

pytestmark = pytest.mark.postgres


def test_all_80_real_ai_scenarios_execute_offline(database_url: str) -> None:
    dataset = Path(__file__).parents[1] / "data" / "ai_eval_scenarios.jsonl"
    scenarios = load_scenarios(dataset)
    with SessionLocal() as db:
        actor = db.scalar(
            select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"]))
        )
    results = [evaluate_scenario(scenario, actor.id) for scenario in scenarios]
    summary = summarize(results)
    assert summary["executed"] == 80
    assert summary["failed"] == 0, "\n".join(
        f"{result.id}: {result.failures}" for result in results if not result.passed
    )
    assert summary["by_category"] == {
        category: {"executed": count, "passed": count} for category, count in EXPECTED_DISTRIBUTION.items()
    }
