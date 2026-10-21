import time
from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
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
    search_text: str
    history: list[str]
    user_id: str
    trace_id: str
    limits: dict[str, Any]
    intent: str
    candidates: list[dict[str, Any]]
    filtered: list[dict[str, Any]]
    publications: list[dict[str, Any]]
    subscriptions: list[dict[str, Any]]
    citations: Annotated[list[dict[str, Any]], lambda left, right: left + right]
    pending_proposal_id: str | None
    specialist_results: Annotated[list[dict[str, Any]], lambda left, right: left + right]
    mcp_invocations: Annotated[list[dict[str, Any]], lambda left, right: left + right]
    delegations: int
    tool_call_count: int
    llm_call_count: int
    tokens_input: int
    tokens_output: int
    estimated_cost: float
    active_elapsed_seconds: float
    active_started_at: float
    needs_clarification: bool
    action_requested: bool
    action_kind: str | None
    support_case: dict[str, Any] | None
    safety_refusal: dict[str, str]
    clarification: dict[str, Any]
    workflow_status: Literal["running", "waiting_user", "waiting_approval", "completed"]
    proposal_result: dict[str, Any]
    answer: str


def build_graph(provider: LlmProvider, checkpointer: Any | None = None):
    def mcp(state: KiosyState) -> KiosyMcpClients:
        return KiosyMcpClients(
            state["user_id"],
            state["trace_id"],
            state.get("limits"),
            initial_tool_calls=state.get("tool_call_count", 0),
            active_started_at=state.get("active_started_at"),
            active_elapsed_seconds=state.get("active_elapsed_seconds", 0.0),
        )

    def ensure_active_budget(state: KiosyState) -> None:
        timeout = float(state.get("limits", {}).get("active_timeout_seconds", 120))
        started = state.get("active_started_at", time.monotonic())
        if state.get("active_elapsed_seconds", 0.0) + (time.monotonic() - started) >= timeout:
            raise DomainError(429, "RUN_ACTIVE_TIMEOUT", "La durée active maximale du run est atteinte.")

    def ensure_llm_budget(state: KiosyState) -> None:
        maximum = int(state.get("limits", {}).get("max_llm_calls", 6))
        if state.get("llm_call_count", 0) >= maximum:
            raise DomainError(429, "LLM_BUDGET_EXCEEDED", "Limite d'appels au modèle atteinte pour ce run.")

    def estimated_tokens(value: str) -> int:
        return max(1, (len(value) + 3) // 4)

    def ensure_token_budget(state: KiosyState, additional: int) -> None:
        maximum = int(state.get("limits", {}).get("max_estimated_tokens", 12_000))
        if state.get("tokens_input", 0) + state.get("tokens_output", 0) + additional > maximum:
            raise DomainError(429, "TOKEN_BUDGET_EXCEEDED", "Budget estimé de tokens atteint pour ce run.")

    def usage(client: KiosyMcpClients) -> dict[str, Any]:
        return {"tool_call_count": client.tool_calls}

    def contextualize(state: KiosyState) -> str:
        text = state["text"].strip()
        history = state.get("history", [])
        if not history:
            return text
        lowered = text.casefold()
        follow_up_markers = (
            "ça",
            "ca",
            "celle",
            "celui",
            "cette publication",
            "cette offre",
            "elle",
            "lui",
            "et pour",
            "est-ce inclus",
            "est ce inclus",
        )
        if len(text.split()) <= 8 or any(marker in lowered for marker in follow_up_markers):
            recent = "\n".join(history[-4:])
            return f"Contexte récent:\n{recent}\nQuestion actuelle: {text}"[:4000]
        return text

    def coordinate(state: KiosyState) -> dict[str, Any]:
        ensure_active_budget(state)
        ensure_llm_budget(state)
        text = state["text"]
        search_text = contextualize(state)
        input_tokens = estimated_tokens(search_text)
        ensure_token_budget(state, input_tokens)
        lowered = text.casefold()
        forbidden_requests = {
            "SECRET_REQUEST": ("montre les secrets", "affiche les tokens", "donne la clé", "donne la cle"),
            "CROSS_USER_ACCESS": (
                "données d'un autre",
                "donnees d'un autre",
                "compte d'un autre",
                "reader b",
            ),
            "ARBITRARY_EXECUTION": (
                "exécute ce sql",
                "execute ce sql",
                "fais une requête http",
                "requete http arbitraire",
            ),
            "UNAUTHORIZED_PAYMENT": (
                "sans confirmation",
                "sans me demander",
                "force le paiement",
                "rembourse directement",
            ),
            "PROMPT_INJECTION": (
                "ignore les instructions",
                "ignore toutes les règles",
                "ignore toutes les regles",
                "system prompt",
            ),
        }
        refusal_code = next(
            (
                code
                for code, markers in forbidden_requests.items()
                if any(marker in lowered for marker in markers)
            ),
            None,
        )
        if refusal_code:
            return {
                "intent": "general",
                "safety_refusal": {
                    "code": refusal_code,
                    "message": "Je ne peux pas exécuter cette demande, car elle contournerait les autorisations ou les règles de sécurité.",
                },
                "needs_clarification": False,
                "action_requested": False,
                "llm_call_count": state.get("llm_call_count", 0),
                "tokens_input": state.get("tokens_input", 0) + input_tokens,
                "workflow_status": "completed",
            }
        intent = provider.classify(search_text)
        vague_subscription = not state.get("clarification") and (
            ("quelque chose" in lowered and "abonnement" in lowered)
            or (
                intent == "subscription"
                and "mon abonnement" in lowered
                and not any(
                    word in lowered
                    for word in (
                        "compare",
                        "résili",
                        "arrêt",
                        "arret",
                        "changer",
                        "accès",
                        "payer",
                        "culture",
                        "presse",
                        "business",
                    )
                )
            )
        )
        cancellation_requested = any(
            marker in lowered
            for marker in (
                "arrêter mon abonnement",
                "arreter mon abonnement",
                "résilier mon abonnement",
                "resilier mon abonnement",
            )
        )
        support_case_requested = any(
            marker in lowered for marker in ("ouvre un ticket", "crée un ticket", "cree un ticket")
        )
        purchase_requested = any(
            word in lowered
            for word in (
                "abonne-moi",
                "achète",
                "acheter",
                "commande cette",
                "je veux m'abonner",
                "je veux souscrire",
            )
        )
        return {
            "intent": intent,
            "search_text": search_text,
            "needs_clarification": vague_subscription,
            "action_requested": purchase_requested or cancellation_requested or support_case_requested,
            "action_kind": "cancel_subscription"
            if cancellation_requested
            else "create_support_case"
            if support_case_requested
            else "purchase"
            if purchase_requested
            else None,
            "llm_call_count": state.get("llm_call_count", 0) + 1,
            "tokens_input": state.get("tokens_input", 0) + input_tokens,
            "workflow_status": "running",
        }

    def clarify(state: KiosyState) -> dict[str, Any]:
        question = "Pouvez-vous préciser l'univers, le titre ou l'action souhaitée pour votre abonnement ?"
        response = interrupt(
            {
                "kind": "clarification",
                "question": question,
                "options": ["Culture", "Presse", "Business", "Gérer mon abonnement"],
            }
        )
        detail = response.get("text", "") if isinstance(response, dict) else str(response)
        return {
            "text": f"{state['text']}\nPrécision de l'utilisateur : {detail[:1000]}",
            "clarification": {"question": question, "answer": detail[:1000]},
            "workflow_status": "running",
            "active_started_at": time.monotonic(),
        }

    def catalog_specialist(state: KiosyState) -> dict[str, Any]:
        client = mcp(state)
        text = state.get("search_text", state["text"])
        lowered = text.casefold()
        requested_universe = next(
            (name for name in ("culture", "presse", "business") if name in lowered), None
        )
        if requested_universe is None and any(
            marker in lowered for marker in ("activité", "activite", "entreprise", "international")
        ):
            requested_universe = "business"
        publication_index = lowered.find("publication")
        if publication_index >= 0:
            search_query = text[publication_index : publication_index + 120].strip(" .!?…")
        elif requested_universe:
            search_query = ""
        elif any(
            marker in lowered for marker in ("conseill", "recommand", "lecture", "offre", "tarif", "prix")
        ):
            search_query = text[:300]
        else:
            search_query = text[:200] if len(text.split()) <= 5 else ""
        search = client.call(
            catalog_mcp,
            "catalog",
            ["catalog:read"],
            "search_publications",
            query=search_query,
            universe=requested_universe,
            limit=8,
        )
        if search_query and not search.get("items"):
            search = client.call(
                catalog_mcp,
                "catalog",
                ["catalog:read"],
                "search_publications",
                query="",
                universe=requested_universe,
                limit=8,
            )
        content_search = client.call(
            assistance_mcp,
            "assistance",
            ["documents:read"],
            "search_authorized_content",
            query=state["text"][:500],
            limit=3,
        )
        content_passages = content_search.get("passages", [])
        content_by_publication = {
            item.get("publication_id"): item for item in content_passages if item.get("publication_id")
        }
        content_citations = [
            {
                "id": item["passage_id"],
                "document_title": item["document_title"],
                "section": item["section"],
                "quote": item["quote"],
                "version": item["version"],
                "effective_date": item.get("effective_date"),
                "href": item.get("href"),
            }
            for item in content_passages
        ]
        candidates: list[dict[str, Any]] = []
        offer_ids: list[str] = []
        candidate_limit = 3
        search_items = search.get("items", [])
        publications = [
            {
                "publication_id": item["publication"]["id"],
                "slug": item["publication"]["slug"],
                "title": item["publication"]["title"],
                "subtitle": item["publication"].get("author")
                or item["publication"].get("publisher", {}).get("name", "Kiosy"),
                "universe": item["publication"]["universe"],
                "summary": item["publication"].get("summary", ""),
                "cover": item["publication"].get("cover") or {},
                "reason": (
                    "Contenu pertinent retrouvé dans cette publication."
                    if item["publication"]["id"] in content_by_publication
                    else f"Publication disponible dans l'univers {item['publication']['universe']}."
                ),
            }
            for item in search_items[:4]
        ]
        for item in search_items:
            publication = client.call(
                catalog_mcp,
                "catalog",
                ["catalog:read"],
                "get_publication",
                publication_id=item["publication"]["id"],
            )
            for offer in publication.get("offers", []):
                if offer.get("status") != "active" or offer["id"] in offer_ids:
                    continue
                candidates.append(
                    {
                        "offer_id": offer["id"],
                        "title": offer["title"],
                        "price": offer["price"],
                        "kind": offer["kind"],
                        "duration": offer.get("duration"),
                        "renewal": offer.get("renewal", "none"),
                        "conditions_version": offer["conditions_version"],
                        "scope": offer.get("scope", {}),
                        "universe": item["publication"].get("universe"),
                    }
                )
                offer_ids.append(offer["id"])
                if len(candidates) >= candidate_limit:
                    break
            if len(candidates) >= candidate_limit:
                break
        if len(offer_ids) >= 2:
            client.call(catalog_mcp, "catalog", ["catalog:read"], "compare_offers", offer_ids=offer_ids[:8])
        result = AgentResult(
            status="ok",
            summary=f"{len(publications)} publication(s) et {len(candidates)} offre(s) candidate(s) via MCP catalogue.",
            evidence_refs=[
                *[f"publication:{item['publication_id']}" for item in publications],
                *[f"offer:{item['offer_id']}" for item in candidates],
            ],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "candidates": candidates,
            "publications": publications,
            "citations": content_citations,
            "specialist_results": [result.model_dump()],
            "mcp_invocations": client.invocations,
            "delegations": state.get("delegations", 0) + 1,
            **usage(client),
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
        subscriptions = client.call(
            commerce_mcp, "commerce", ["subscriptions:read"], "get_my_subscriptions"
        )
        result = AgentResult(
            status="ok",
            summary=f"{excluded} offre(s) déjà couverte(s) exclue(s); {len(subscriptions)} abonnement(s) actuel(s) vérifié(s) via MCP commerce.",
            evidence_refs=[f"offer:{item['offer_id']}" for item in filtered],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "filtered": filtered,
            "subscriptions": subscriptions,
            "specialist_results": [result.model_dump()],
            "mcp_invocations": client.invocations,
            "delegations": state.get("delegations", 0) + 1,
            **usage(client),
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
                query="",
            )
            for passage in terms.get("passages", []):
                citations.append(
                    {
                        "id": f"vente:{version}:{passage['section_id']}",
                        "document_title": "Conditions générales de vente",
                        "section": passage["title"],
                        "quote": passage["quote"],
                        "version": version,
                        "effective_date": passage.get("effective_date"),
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
                query="",
            )
            for passage in terms.get("passages", []):
                citations.append(
                    {
                        "id": f"vente:{fallback_version}:{passage['section_id']}",
                        "document_title": "Conditions générales de vente",
                        "section": passage["title"],
                        "quote": passage["quote"],
                        "version": fallback_version,
                        "effective_date": passage.get("effective_date"),
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
                            "effective_date": passage.get("effective_date"),
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
            "mcp_invocations": client.invocations,
            "delegations": state.get("delegations", 0) + 1,
            **usage(client),
        }

    def support_specialist(state: KiosyState) -> dict[str, Any]:
        max_delegations = int(state.get("limits", {}).get("max_delegations", 4))
        if state.get("delegations", 0) >= max_delegations:
            raise DomainError(429, "DELEGATION_BUDGET_EXCEEDED", "Limite de délégations atteinte.")
        client = mcp(state)
        search = client.call(
            catalog_mcp,
            "catalog",
            ["catalog:read"],
            "search_publications",
            query=state["text"][:200],
            limit=3,
        )
        diagnosis: dict[str, Any] = {"status": "not_found", "reason": "EDITION_NOT_IDENTIFIED"}
        evidence: list[str] = []
        items = search.get("items", [])
        if items:
            detail = client.call(
                catalog_mcp,
                "catalog",
                ["catalog:read"],
                "get_publication",
                publication_id=items[0]["publication"]["id"],
            )
            editions = detail.get("editions", [])
            if editions:
                diagnosis = client.call(
                    assistance_mcp,
                    "assistance",
                    ["access:diagnose"],
                    "diagnose_access",
                    edition_id=editions[0]["id"],
                )
                evidence.append(f"edition:{editions[0]['id']}")
        subscriptions = client.call(commerce_mcp, "commerce", ["subscriptions:read"], "get_my_subscriptions")
        support_case = None
        if state.get("action_kind") == "create_support_case":
            created = client.call(
                assistance_mcp,
                "assistance",
                ["support:write"],
                "create_support_case",
                subject="Accès à une publication",
                category="access",
                body=state["text"][:1000],
            )
            support_case = created.get("case")
        result = AgentResult(
            status="ok" if diagnosis.get("status") in {"allowed", "denied"} else "needs_input",
            summary=f"Diagnostic d'accès : {diagnosis.get('status', 'inconnu')}; {len(subscriptions)} abonnement(s) vérifié(s).",
            evidence_refs=evidence,
            proposed_actions=(
                [{"type": "support_case", "case": support_case}]
                if support_case
                else [{"type": "create_support_case", "requires_confirmation": True}]
                if diagnosis.get("status") != "allowed"
                else []
            ),
            missing_information=[] if evidence else ["Titre ou édition concernée"],
            warnings=["Aucun droit d'accès n'est attribué par le diagnostic."],
            trace_id=state["trace_id"],
            mcp_tools=[item["tool"] for item in client.invocations],
        )
        return {
            "specialist_results": [result.model_dump()],
            "mcp_invocations": client.invocations,
            "delegations": state.get("delegations", 0) + 1,
            "support_case": support_case,
            **usage(client),
        }

    def prepare_purchase(state: KiosyState) -> dict[str, Any]:
        offers = state.get("filtered") or state.get("candidates", [])
        if not offers:
            return {"workflow_status": "completed"}
        lowered = state["text"].casefold()
        if any(marker in lowered for marker in ("souscri", "abonnement", "m'abonner")):
            selected = next((item for item in offers if item.get("kind") == "subscription"), offers[0])
        else:
            selected = next(
                (
                    item
                    for item in offers
                    if item.get("kind") != "free" and item.get("price", {}).get("amount", 0) > 0
                ),
                offers[0],
            )
        client = mcp(state)
        prepared = client.call(
            commerce_mcp,
            "commerce",
            ["purchase:prepare"],
            "prepare_purchase",
            offer_id=selected["offer_id"],
        )
        return {
            "pending_proposal_id": prepared.get("proposal_id"),
            "mcp_invocations": client.invocations,
            **usage(client),
        }

    def prepare_cancellation(state: KiosyState) -> dict[str, Any]:
        client = mcp(state)
        subscriptions = client.call(commerce_mcp, "commerce", ["subscriptions:read"], "get_my_subscriptions")
        active = next((item for item in subscriptions if item.get("status") == "active"), None)
        if not active:
            return {
                "workflow_status": "completed",
                "mcp_invocations": client.invocations,
                **usage(client),
            }
        prepared = client.call(
            commerce_mcp,
            "commerce",
            ["subscriptions:write"],
            "prepare_cancellation",
            subscription_id=active["id"],
        )
        return {
            "pending_proposal_id": prepared.get("proposal_id"),
            "mcp_invocations": client.invocations,
            **usage(client),
        }

    def await_approval(state: KiosyState) -> dict[str, Any]:
        proposal_id = state.get("pending_proposal_id")
        if not proposal_id:
            return {"workflow_status": "completed"}
        decision = interrupt({"kind": "approval", "proposal_id": proposal_id})
        normalized = decision if isinstance(decision, dict) else {"decision": str(decision)}
        return {
            "proposal_result": normalized,
            "workflow_status": "completed",
            "active_started_at": time.monotonic(),
        }

    def compose(state: KiosyState) -> dict[str, Any]:
        ensure_active_budget(state)
        if state.get("safety_refusal"):
            return {
                "answer": state["safety_refusal"]["message"],
                "workflow_status": "completed",
            }
        ensure_llm_budget(state)
        offers = state.get("filtered") or state.get("candidates", [])
        evidence = [result["summary"] for result in state.get("specialist_results", [])]
        evidence.extend(
            f"PUBLICATION CANDIDATE: {item['title']} ({item['universe']}) — {item.get('summary') or 'résumé non renseigné'}"
            for item in state.get("publications", [])[:4]
        )
        evidence.extend(
            f"OFFRE CANDIDATE NON PRÉSENTÉE COMME POSSÉDÉE: {item['title']} — {item['price']['amount']} {item['price']['currency']}"
            for item in offers[:4]
        )
        subscriptions = state.get("subscriptions", [])
        evidence.extend(
            f"ABONNEMENT ACTUEL: {item.get('offer', {}).get('title', 'Abonnement')} — statut {item.get('status', 'inconnu')}"
            for item in subscriptions[:4]
        )
        if state.get("intent") in {"subscription", "cooperate"} and not subscriptions:
            evidence.append("ABONNEMENTS DU COMPTE: aucun abonnement actuel trouvé.")
        evidence.extend(
            f"{item['document_title']}, {item['section']}: {item['quote']}"
            for item in state.get("citations", [])[:3]
        )
        pending = state.get("pending_proposal_id")
        if pending:
            proposal_result = state.get("proposal_result")
            if proposal_result:
                evidence.append(str(proposal_result.get("summary") or "La proposition a été traitée."))
            else:
                evidence.append(f"Une action sensible nécessite confirmation (proposition {pending}).")
        composed_input = state["text"] + "\n" + "\n".join(evidence)
        input_tokens = estimated_tokens(composed_input)
        ensure_token_budget(state, input_tokens)
        answer = provider.compose(state["text"], evidence, state.get("history"))
        output_tokens = estimated_tokens(answer)
        ensure_token_budget(state, input_tokens + output_tokens)
        return {
            "answer": answer,
            "llm_call_count": state.get("llm_call_count", 0) + 1,
            "tokens_input": state.get("tokens_input", 0) + input_tokens,
            "tokens_output": state.get("tokens_output", 0) + output_tokens,
            "estimated_cost": state.get("estimated_cost", 0.0),
            "workflow_status": "completed",
        }

    def route_from_coordinator(state: KiosyState) -> str:
        if state.get("needs_clarification"):
            return "clarify"
        if state["intent"] in {"catalog", "subscription", "cooperate"}:
            return "catalog"
        if state["intent"] == "conditions":
            return "conditions"
        if state["intent"] == "support":
            return "support"
        return "compose"

    def route_from_catalog(state: KiosyState) -> str:
        return (
            "subscriptions"
            if state["intent"] in {"subscription", "cooperate"} or state.get("action_requested")
            else "compose"
        )

    def route_from_subscriptions(state: KiosyState) -> str:
        if state.get("action_kind") == "cancel_subscription":
            return "prepare_cancellation"
        if state.get("action_kind") == "purchase":
            return "prepare_purchase"
        return "conditions" if state["intent"] == "cooperate" else "compose"

    graph = StateGraph(KiosyState)
    graph.add_node("coordinate", coordinate)
    graph.add_node("clarify", clarify)
    graph.add_node("catalog", catalog_specialist)
    graph.add_node("subscriptions", subscription_specialist)
    graph.add_node("conditions", conditions_specialist)
    graph.add_node("support", support_specialist)
    graph.add_node("prepare_purchase", prepare_purchase)
    graph.add_node("prepare_cancellation", prepare_cancellation)
    graph.add_node("await_approval", await_approval)
    graph.add_node("compose", compose)
    graph.add_edge(START, "coordinate")
    graph.add_conditional_edges(
        "coordinate",
        route_from_coordinator,
        {
            "clarify": "clarify",
            "catalog": "catalog",
            "conditions": "conditions",
            "support": "support",
            "compose": "compose",
        },
    )
    graph.add_edge("clarify", "coordinate")
    graph.add_conditional_edges(
        "catalog", route_from_catalog, {"subscriptions": "subscriptions", "compose": "compose"}
    )
    graph.add_conditional_edges(
        "subscriptions",
        route_from_subscriptions,
        {
            "prepare_purchase": "prepare_purchase",
            "prepare_cancellation": "prepare_cancellation",
            "conditions": "conditions",
            "compose": "compose",
        },
    )
    graph.add_edge("prepare_purchase", "await_approval")
    graph.add_edge("prepare_cancellation", "await_approval")
    graph.add_edge("await_approval", "compose")
    graph.add_edge("conditions", "compose")
    graph.add_edge("support", "compose")
    graph.add_edge("compose", END)
    return graph.compile(checkpointer=checkpointer)
