import pytest
from sqlalchemy import select

from app.ai.orchestration import build_graph
from app.ai.providers import DeterministicProvider
from app.db.base import SessionLocal
from app.db.models import User

pytestmark = pytest.mark.postgres


def test_specialists_invoke_real_mcp_tools(database_url: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email.in_(["reader1@example.com", "reader1@local.kiosy.test"])))
    graph = build_graph(DeterministicProvider())
    result = graph.invoke(
        {
            "text": "Compare les offres et abonnements, exclue ce qui est déjà couvert puis vérifie les conditions.",
            "user_id": user.id,
            "trace_id": "orch-mcp-test",
            "limits": {"max_delegations": 4, "max_tool_calls": 20, "active_timeout_seconds": 120},
            "specialist_results": [],
            "mcp_invocations": [],
            "delegations": 0,
        }
    )
    tools = {item["tool"] for item in result.get("mcp_invocations", [])}
    assert len(result.get("specialist_results", [])) == 3
    assert "search_publications" in tools
    assert len(result.get("mcp_invocations", [])) >= 3
    assert tools.intersection({"get_my_subscriptions", "read_my_entitlements", "check_entitlement"})
    assert tools.intersection({"search_terms", "get_authorized_excerpt", "search_conditions"})
