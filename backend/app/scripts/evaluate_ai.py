from pathlib import Path

from sqlalchemy import select

from app.ai.evaluation import evaluate_scenario, load_scenarios, render_report
from app.db.base import SessionLocal
from app.db.models import User


def main() -> int:
    dataset = Path(__file__).parents[2] / "data" / "ai_eval_scenarios.jsonl"
    scenarios = load_scenarios(dataset)
    with SessionLocal() as db:
        users = {
            user.email: user.id
            for user in db.scalars(select(User).where(User.email.in_({s.actor for s in scenarios})))
        }
    missing = sorted({scenario.actor for scenario in scenarios} - set(users))
    if missing:
        raise RuntimeError(f"Missing benchmark actors: {', '.join(missing)}")
    results = [evaluate_scenario(scenario, users[scenario.actor]) for scenario in scenarios]
    print(render_report(results))
    return 1 if any(not result.passed for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
