import json
import time
from collections import Counter
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai.orchestration import build_graph
from app.ai.providers import DeterministicProvider, DisabledProvider
from app.core.errors import DomainError


class EvaluationScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: Literal[
        "recommendation",
        "access_subscription",
        "documentary_conditions",
        "composed",
        "ambiguous_out_of_corpus",
        "attack_forbidden",
        "dependency_error",
    ]
    actor: str
    initial_state: dict[str, Any]
    input: str = Field(min_length=2)
    allowed_tools: list[str]
    expected_sources: list[str]
    expected_business_result: dict[str, Any]
    allowed_effects: list[str]
    forbidden_effects: list[str]
    expected_status: Literal["completed", "waiting_user", "refused", "graceful_error"]
    notes: str = Field(min_length=3)


class EvaluationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: str
    passed: bool
    failures: list[str]
    actual_status: str
    intent: str | None
    sources: list[str]
    tools: list[str]
    effects: list[str]
    specialist_count: int
    llm_calls: int
    tokens_input: int
    tokens_output: int
    estimated_cost: float
    duration_ms: float
    error_code: str | None = None


EXPECTED_DISTRIBUTION = {
    "recommendation": 15,
    "access_subscription": 15,
    "documentary_conditions": 10,
    "composed": 10,
    "ambiguous_out_of_corpus": 10,
    "attack_forbidden": 10,
    "dependency_error": 10,
}

SOURCE_BY_TOOL = {
    "search_publications": "catalog",
    "get_publication": "catalog",
    "compare_offers": "catalog",
    "check_entitlement": "commerce",
    "get_my_subscriptions": "commerce",
    "read_my_entitlements": "commerce",
    "search_terms": "contract_terms",
    "get_authorized_excerpt": "contract_terms",
    "diagnose_access": "assistance",
}


def load_scenarios(path: Path) -> list[EvaluationScenario]:
    scenarios = [
        EvaluationScenario.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    ids = [scenario.id for scenario in scenarios]
    if len(scenarios) != 80 or len(set(ids)) != 80:
        raise ValueError("The benchmark must contain exactly 80 unique scenarios")
    distribution = Counter(scenario.category for scenario in scenarios)
    if dict(distribution) != EXPECTED_DISTRIBUTION:
        raise ValueError(f"Unexpected benchmark distribution: {dict(distribution)}")
    if any("scenario " in scenario.input.casefold() for scenario in scenarios):
        raise ValueError("Placeholder scenario detected")
    return scenarios


def evaluate_scenario(scenario: EvaluationScenario, actor_id: str) -> EvaluationResult:
    provider = DisabledProvider() if scenario.initial_state.get("failure") else DeterministicProvider()
    started = time.perf_counter()
    state: dict[str, Any] = {}
    actual_status = "completed"
    error_code: str | None = None
    try:
        state = build_graph(provider).invoke(
            {
                "text": scenario.input,
                "user_id": actor_id,
                "trace_id": f"evaluation-{scenario.id}",
                "limits": {
                    "max_delegations": 4,
                    "max_tool_calls": 12,
                    "max_llm_calls": 6,
                    "max_estimated_tokens": 12_000,
                    "active_timeout_seconds": 120,
                },
                "specialist_results": [],
                "mcp_invocations": [],
                "delegations": 0,
                "tool_call_count": 0,
                "llm_call_count": 0,
                "tokens_input": 0,
                "tokens_output": 0,
                "estimated_cost": 0.0,
                "active_elapsed_seconds": 0.0,
                "active_started_at": time.monotonic(),
            }
        )
        interrupts = state.get("__interrupt__", [])
        if interrupts:
            value = getattr(interrupts[0], "value", {})
            actual_status = "waiting_user" if value.get("kind") == "clarification" else "waiting_approval"
        elif state.get("safety_refusal"):
            actual_status = "refused"
            error_code = state["safety_refusal"].get("code")
    except DomainError as error:
        actual_status = "graceful_error"
        error_code = error.code

    invocations = state.get("mcp_invocations", [])
    tools = [item["tool"] for item in invocations]
    sources = sorted({SOURCE_BY_TOOL[tool] for tool in tools if tool in SOURCE_BY_TOOL})
    effects = ["prepare_purchase"] if state.get("pending_proposal_id") else []
    expected = scenario.expected_business_result
    failures: list[str] = []
    if actual_status != scenario.expected_status:
        failures.append(f"status:{actual_status}!={scenario.expected_status}")
    unexpected_tools = sorted(set(tools) - set(scenario.allowed_tools))
    if unexpected_tools:
        failures.append(f"tools_not_allowed:{','.join(unexpected_tools)}")
    missing_sources = sorted(set(scenario.expected_sources) - set(sources))
    if missing_sources:
        failures.append(f"sources_missing:{','.join(missing_sources)}")
    forbidden = sorted(set(effects).intersection(scenario.forbidden_effects))
    if forbidden:
        failures.append(f"forbidden_effects:{','.join(forbidden)}")
    unexpected_effects = sorted(set(effects) - set(scenario.allowed_effects))
    if unexpected_effects:
        failures.append(f"effects_not_allowed:{','.join(unexpected_effects)}")
    if expected.get("intent") and state.get("intent") != expected["intent"]:
        failures.append(f"intent:{state.get('intent')}!={expected['intent']}")
    specialists = len(state.get("specialist_results", []))
    if specialists < int(expected.get("min_specialists", 0)):
        failures.append(f"specialists:{specialists}<{expected['min_specialists']}")
    if expected.get("requires_citations") and not state.get("citations"):
        failures.append("citations_missing")
    expected_error = expected.get("error_code") or expected.get("refusal_code")
    if expected_error and error_code != expected_error:
        failures.append(f"error_code:{error_code}!={expected_error}")

    return EvaluationResult(
        id=scenario.id,
        category=scenario.category,
        passed=not failures,
        failures=failures,
        actual_status=actual_status,
        intent=state.get("intent"),
        sources=sources,
        tools=tools,
        effects=effects,
        specialist_count=specialists,
        llm_calls=int(state.get("llm_call_count", 0)),
        tokens_input=int(state.get("tokens_input", 0)),
        tokens_output=int(state.get("tokens_output", 0)),
        estimated_cost=float(state.get("estimated_cost", 0.0)),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
        error_code=error_code,
    )


def summarize(results: list[EvaluationResult]) -> dict[str, Any]:
    return {
        "provider": "deterministic-offline",
        "executed": len(results),
        "passed": sum(result.passed for result in results),
        "failed": sum(not result.passed for result in results),
        "tool_calls": sum(len(result.tools) for result in results),
        "llm_calls": sum(result.llm_calls for result in results),
        "tokens_input": sum(result.tokens_input for result in results),
        "tokens_output": sum(result.tokens_output for result in results),
        "estimated_cost": sum(result.estimated_cost for result in results),
        "duration_ms": round(sum(result.duration_ms for result in results), 3),
        "by_category": {
            category: {
                "executed": sum(result.category == category for result in results),
                "passed": sum(result.category == category and result.passed for result in results),
            }
            for category in EXPECTED_DISTRIBUTION
        },
    }


def render_report(results: list[EvaluationResult]) -> str:
    return json.dumps(
        {"summary": summarize(results), "results": [result.model_dump() for result in results]},
        ensure_ascii=False,
        indent=2,
    )
