from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field

from app.ai.providers import LlmProvider
from app.core.errors import DomainError
from app.mcp.invoke import KiosyMcpClients
from app.mcp.servers import assistance_mcp, catalog_mcp, commerce_mcp


class AgentResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok", "needs_input", "blocked", "failed"]
    summary: str
    evidence_refs: list[str] = Field(default_factory=list)
    proposed_actions: list[dict[str, Any]] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    trace_id: str
    mcp_tools: list[str] = Field(default_factory=list)


class KiosyState(TypedDict, total=False):
    text: str
    user_id: str
    trace_id: str
    limits: dict[str, Any]
    intent: str
    candidates: list[dict[str, Any]]
    filtered: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    pending_proposal_id: str | None
    specialist_results: Annotated[list[dict[str, Any]], lambda left, right: left + right]
    mcp_invocations: Annotated[list[dict[str, Any]], lambda left, right: left + right]
    delegations: int
    answer: str


def build_graph(provider: LlmProvider, checkpointer: Any | None = None):
    def mcp(state: KiosyState) -> KiosyMcpClients:
        return KiosyMcpClients(state["user_id"], state["trace_id"], state.get("limits"))

    def coordinate(state: KiosyState) -> dict[str, Any]:
        return {"intent": provider.classify(state["text"]), "specialist_results": [], "mcp_invocations": [], "delegations": 0}

    def catalog_specialist(state: KiosyState) -> dict[str, Any]:
        client = mcp(state)
        requested_universe = next((name for name in ("culture", "presse", "business") if name in state["text"].casefold()), None)
        search = client.call(
            catalog_mcp,
            "catalog",
            ["catalog:read"],
            "search_publications",
            query=state["text"][:200],
            universe=requested_universe,
            limit=8,
        )
        candidates: list[dict[str, Any]] = []
        offer_ids: list[str] = []
        for item in search.get("items", []):
            publication = client.call(
                catalog_mcp,
                "catalog",
                ["catalog:read"],
                "get_publication",
                publication_id=item["publication"]["id"],
            )
            for offer in publication.get("offers", []):
                if offer.get("status") != "active":
                    continue
                candidates.append(
                    {
                        "offer_id": offer["id"],
                        "title": offer["title"],
                        "price": offer["price"],
                        "conditions_version": offer["conditions_version"],
                        "scope": offer.get("scope", {}),
                        "universe": item["publication"].get("universe"),
                    }
                )
                offer_ids.append(offer["id"])
                if len(candidates) >= 8:
                    break
            if len(candidates) >= 8:
                break
        if len(offer_ids) >= 2:
            client.call(catalog_mcp, "catalog", ["catalog:read"], "compare_offers", offer_ids=offer_ids[:8])
        result = AgentResult(
            status="ok",
            summary=f"{len(candidates)} offre(s) candidate(s) via MCP catalogue.",
            evidence_refs=[f"offer:{item['offer_id']}" for item in candidates],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "candidates": candidates,
            "specialist_results": [result.model_dump()],
            "mcp_invocations": client.invocations,
            "delegations": state.get("delegations", 0) + 1,
        }

    def subscription_specialist(state: KiosyState) -> dict[str, Any]:
        max_delegations = int(state.get("limits", {}).get("max_delegations", 4))
        if state.get("delegations", 0) >= max_delegations:
            raise DomainError(429, "DELEGATION_BUDGET_EXCEEDED", "Limite de délégations atteinte.")
        client = mcp(state)
        filtered: list[dict[str, Any]] = []
        excluded = 0
        for candidate in state.get("candidates", []):
            check = client.call(
                commerce_mcp,
                "commerce",
                ["entitlements:read"],
                "check_entitlement",
                offer_id=candidate["offer_id"],
            )
            if check.get("covered"):
                excluded += 1
            else:
                filtered.append(candidate)
        client.call(commerce_mcp, "commerce", ["subscriptions:read"], "get_my_subscriptions")
        result = AgentResult(
            status="ok",
            summary=f"{excluded} offre(s) déjà couverte(s) exclue(s) via MCP commerce.",
            evidence_refs=[f"offer:{item['offer_id']}" for item in filtered],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "filtered": filtered,
            "specialist_results": [result.model_dump()],
            "mcp_invocations": state.get("mcp_invocations", []) + client.invocations,
            "delegations": state.get("delegations", 0) + 1,
        }

    def conditions_specialist(state: KiosyState) -> dict[str, Any]:
        max_delegations = int(state.get("limits", {}).get("max_delegations", 4))
        if state.get("delegations", 0) >= max_delegations:
            raise DomainError(429, "DELEGATION_BUDGET_EXCEEDED", "Limite de délégations atteinte.")
        client = mcp(state)
        offers = state.get("filtered") or state.get("candidates", [])
        versions = {item["conditions_version"] for item in offers if item.get("conditions_version")}
        citations: list[dict[str, Any]] = []
        for version in versions:
            terms = client.call(
                assistance_mcp,
                "assistance",
                ["documents:read"],
                "search_terms",
                version=version,
                query=state["text"][:120],
            )
            for passage in terms.get("passages", []):
                citations.append(
                    {
                        "id": f"vente:{version}:{passage['section_id']}",
                        "document_title": "Conditions générales de vente",
                        "section": passage["title"],
                        "quote": passage["quote"],
                        "version": version,
                        "href": passage["href"],
                    }
                )
        if not citations:
            fallback_version = "mvp-2026-10-01"
            terms = client.call(
                assistance_mcp,
                "assistance",
                ["documents:read"],
                "search_terms",
                version=fallback_version,
                query=state["text"][:120] or "vente",
            )
            for passage in terms.get("passages", []):
                citations.append(
                    {
                        "id": f"vente:{fallback_version}:{passage['section_id']}",
                        "document_title": "Conditions générales de vente",
                        "section": passage["title"],
                        "quote": passage["quote"],
                        "version": fallback_version,
                        "href": passage["href"],
                    }
                )
            if not citations:
                excerpt = client.call(
                    assistance_mcp,
                    "assistance",
                    ["documents:read"],
                    "get_authorized_excerpt",
                    query=state["text"][:200],
                    limit=3,
                )
                for passage in excerpt.get("passages", []):
                    citations.append(
                        {
                            "id": passage.get("passage_id") or passage.get("section_id"),
                            "document_title": passage.get("document_id", "document"),
                            "section": passage.get("section") or passage.get("title", ""),
                            "quote": passage["quote"],
                            "version": passage.get("version"),
                            "href": passage["href"],
                        }
                    )
        status: Literal["ok", "needs_input", "blocked", "failed"] = "ok" if citations else "blocked"
        result = AgentResult(
            status=status,
            summary=f"{len(citations)} citation(s) contractuelle(s) vérifiée(s) via MCP assistance.",
            evidence_refs=[item["id"] for item in citations if item.get("id")],
            missing_information=[] if citations else ["Version contractuelle applicable introuvable"],
            warnings=["Explication informative, pas un avis juridique."],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "citations": citations,
            "specialist_results": [result.model_dump()],
            "mcp_invocations": state.get("mcp_invocations", []) + client.invocations,
            "delegations": state.get("delegations", 0) + 1,
        }

    def compose(state: KiosyState) -> dict[str, Any]:
        offers = state.get("filtered") or state.get("candidates", [])
        evidence = [result["summary"] for result in state.get("specialist_results", [])]
        evidence.extend(f"{item['title']} — {item['price']['amount']} {item['price']['currency']}" for item in offers[:4])
        evidence.extend(f"{item['document_title']}, {item['section']}: {item['quote']}" for item in state.get("citations", [])[:3])
        pending = state.get("pending_proposal_id")
        if pending:
            evidence.append(f"Une action sensible nécessite confirmation (proposition {pending}).")
        return {"answer": provider.compose(state["text"], evidence)}

    def route_from_coordinator(state: KiosyState) -> str:
        if state["intent"] in {"catalog", "subscription", "cooperate"}:
            return "catalog"
        if state["intent"] == "conditions":
            return "conditions"
        return "compose"

    def route_from_catalog(state: KiosyState) -> str:
        return "subscriptions" if state["intent"] in {"subscription", "cooperate"} else "compose"

    def route_from_subscriptions(state: KiosyState) -> str:
        return "conditions" if state["intent"] == "cooperate" else "compose"

    graph = StateGraph(KiosyState)
    graph.add_node("coordinate", coordinate)
    graph.add_node("catalog", catalog_specialist)
    graph.add_node("subscriptions", subscription_specialist)
    graph.add_node("conditions", conditions_specialist)
    graph.add_node("compose", compose)
    graph.add_edge(START, "coordinate")
    graph.add_conditional_edges("coordinate", route_from_coordinator, {"catalog": "catalog", "conditions": "conditions", "compose": "compose"})
    graph.add_conditional_edges("catalog", route_from_catalog, {"subscriptions": "subscriptions", "compose": "compose"})
    graph.add_conditional_edges("subscriptions", route_from_subscriptions, {"conditions": "conditions", "compose": "compose"})
    graph.add_edge("conditions", "compose")
    graph.add_edge("compose", END)
    return graph.compile(checkpointer=checkpointer)
