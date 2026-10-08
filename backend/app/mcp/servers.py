import hashlib
import json
from datetime import timedelta
from typing import Any

from mcp.server import MCPServer
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.shared.exceptions import MCPError
from mcp_types import INVALID_PARAMS
from sqlalchemy import select

from app.ai.providers import provider_from_settings
from app.ai.retrieval import RetrievalIndex
from app.api.account import active_entitlements, subscription_out
from app.api.serializers import iso, offer_out
from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.security import utcnow
from app.db.base import SessionLocal
from app.db.models import (
    ContractDocumentVersion,
    Edition,
    Proposal,
    Publication,
    Subscription,
    User,
)
from app.domains.catalog_service import catalog, get_latest_offer, publication_detail
from app.domains.commerce_service import eligibility
from app.domains.support_service import case_summary
from app.domains.support_service import create_support_case as persist_support_case
from app.mcp.auth import verify_context

catalog_mcp = MCPServer("kiosy-catalog")
commerce_mcp = MCPServer("kiosy-commerce")
assistance_mcp = MCPServer("kiosy-assistance")


@catalog_mcp.tool()
def search_publications(
    context_token: str, query: str = "", universe: str | None = None, limit: int = 5
) -> dict[str, Any]:
    """Search published Kiosy publications. Inputs are closed and results are bounded."""
    verify_context(context_token, "catalog", "catalog:read")
    with SessionLocal() as db:
        result = catalog(
            db,
            q=query[:200] or None,
            universe=universe,
            language=None,
            format=None,
            price=None,
            sort="recent",
            page=1,
            page_size=max(1, min(limit, 10)),
        )
    return result


@catalog_mcp.tool()
def get_offer(context_token: str, offer_id: str) -> dict[str, Any]:
    """Return the latest authoritative version of one offer."""
    verify_context(context_token, "catalog", "catalog:read")
    with SessionLocal() as db:
        return offer_out(get_latest_offer(db, offer_id))


@catalog_mcp.tool()
def get_publication(context_token: str, publication_id: str) -> dict[str, Any]:
    """Return one published publication with editions and active offers."""
    verify_context(context_token, "catalog", "catalog:read")
    with SessionLocal() as db:
        return publication_detail(db, publication_id)


@catalog_mcp.tool()
def compare_offers(context_token: str, offer_ids: list[str]) -> dict[str, Any]:
    """Compare up to eight offers using authoritative server prices."""
    verify_context(context_token, "catalog", "catalog:read")
    if not offer_ids or len(offer_ids) > 8:
        raise DomainError(422, "INVALID_ARGUMENT", "Entre 1 et 8 offres attendues.")
    with SessionLocal() as db:
        items = []
        for offer_id in offer_ids:
            offer = get_latest_offer(db, offer_id)
            items.append(offer_out(offer))
        items.sort(key=lambda row: (row["price"]["amount"], row["title"]))
        return {"offers": items, "cheapest_offer_id": items[0]["id"] if items else None}


@catalog_mcp.tool()
def get_contract_excerpt(
    context_token: str, document_id: str, version: str, section_id: str | None = None
) -> dict[str, Any]:
    """Return a bounded excerpt from an exact contract version (no substitution)."""
    verify_context(context_token, "catalog", "catalog:read")
    with SessionLocal() as db:
        document = db.scalar(
            select(ContractDocumentVersion).where(
                ContractDocumentVersion.document_id == document_id,
                ContractDocumentVersion.version == version,
            )
        )
        if not document:
            return {"status": "NOT_FOUND", "passages": []}
        sections = document.sections
        if section_id:
            sections = [section for section in sections if section["id"] == section_id]
        return {
            "status": "ok",
            "document_id": document_id,
            "version": version,
            "passages": [
                {
                    "section_id": section["id"],
                    "title": section["title"],
                    "quote": section["body"][:500],
                    "href": f"/conditions/{document_id}?version={version}#{section['id']}",
                }
                for section in sections[:3]
            ],
        }


@commerce_mcp.tool()
def list_my_subscriptions(context_token: str) -> list[dict[str, Any]]:
    """Read subscriptions belonging to the asserted reader."""
    context = verify_context(context_token, "commerce", "subscriptions:read")
    with SessionLocal() as db:
        return [
            subscription_out(row)
            for row in db.scalars(select(Subscription).where(Subscription.user_id == context["sub"]))
        ]


@commerce_mcp.tool()
def get_my_subscriptions(context_token: str) -> list[dict[str, Any]]:
    """Alias stable pour list_my_subscriptions."""
    return list_my_subscriptions(context_token)


@commerce_mcp.tool()
def check_entitlement(context_token: str, offer_id: str) -> dict[str, Any]:
    """Check whether the reader already owns or overlaps an offer."""
    context = verify_context(context_token, "commerce", "entitlements:read")
    with SessionLocal() as db:
        user = db.get(User, context["sub"])
        offer = get_latest_offer(db, offer_id)
        facts = eligibility(db, user, offer)
        return {
            "offer_id": offer_id,
            "covered": facts["already_owned"] or bool(facts["overlaps"]),
            "eligibility": facts,
        }


@commerce_mcp.tool()
def read_my_entitlements(context_token: str) -> list[dict[str, Any]]:
    """Read current entitlements belonging to the asserted reader."""
    context = verify_context(context_token, "commerce", "entitlements:read")
    with SessionLocal() as db:
        rows = active_entitlements(db, context["sub"])
        return [
            {
                "id": row.id,
                "scope": row.scope,
                "valid_until": row.valid_until.isoformat() if row.valid_until else None,
                "source": row.source,
            }
            for row in rows
        ]


@commerce_mcp.tool()
def prepare_purchase(context_token: str, offer_id: str) -> dict[str, Any]:
    """Prepare purchase facts only. This tool never creates an order or payment."""
    context = verify_context(context_token, "commerce", "purchase:prepare")
    with SessionLocal() as db:
        user = db.get(User, context["sub"])
        offer = get_latest_offer(db, offer_id)
        facts = eligibility(db, user, offer)
        if not facts["can_purchase"]:
            code = facts.get("blocking_reason") or "ACCESS_DENIED"
            return {
                "status": code,
                "offer": offer_out(offer),
                "eligibility": facts,
                "requires_confirmation": False,
            }
        trace_id = context.get("trace_id")
        if trace_id:
            existing = next(
                (
                    proposal
                    for proposal in db.scalars(
                        select(Proposal).where(
                            Proposal.actor_id == user.id,
                            Proposal.type == "purchase",
                            Proposal.status == "pending",
                        )
                    )
                    if proposal.parameters.get("trace_id") == trace_id
                    and proposal.parameters.get("offer_id") == offer.offer_key
                ),
                None,
            )
            if existing:
                return {
                    "status": "APPROVAL_REQUIRED",
                    "proposal_id": existing.id,
                    "offer": offer_out(offer),
                    "eligibility": facts,
                    "requires_confirmation": True,
                    "expires_at": iso(existing.expires_at),
                }
        normalized_arguments = {"offer_id": offer.offer_key, "offer_version": offer.version}
        fingerprint = hashlib.sha256(
            json.dumps(normalized_arguments, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        row = Proposal(
            actor_id=user.id,
            type="purchase",
            status="pending",
            title=f"Acheter {offer.title}",
            resource={"type": "offer", "id": offer.offer_key, "label": offer.title, "version": offer.version},
            parameters={
                **normalized_arguments,
                "normalized_arguments": normalized_arguments,
                "resource_version": offer.version,
                "currency": offer.price_currency,
                "fingerprint": fingerprint,
                "trace_id": trace_id,
            },
            consequences=[
                "Création d'une commande après confirmation explicite.",
                "Paiement de test uniquement en sandbox.",
            ],
            amount=offer_out(offer)["price"],
            conditions_version=offer.conditions_version,
            expires_at=utcnow() + timedelta(minutes=15),
            approval="self",
            origin="assistant",
        )
        db.add(row)
        db.commit()
        return {
            "status": "APPROVAL_REQUIRED",
            "proposal_id": row.id,
            "offer": offer_out(offer),
            "eligibility": facts,
            "requires_confirmation": True,
            "expires_at": iso(row.expires_at),
        }


@commerce_mcp.tool()
def prepare_plan_change(context_token: str, subscription_id: str, target_offer_id: str) -> dict[str, Any]:
    """Prepare a plan change proposal; execution requires human confirmation."""
    context = verify_context(context_token, "commerce", "subscriptions:write")
    with SessionLocal() as db:
        subscription = db.scalar(
            select(Subscription).where(
                Subscription.id == subscription_id, Subscription.user_id == context["sub"]
            )
        )
        if not subscription:
            raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
        row = Proposal(
            actor_id=context["sub"],
            type="change_plan",
            status="pending",
            title="Changer de formule à l'échéance",
            resource={
                "type": "subscription",
                "id": subscription.id,
                "label": subscription.offer_snapshot["title"],
                "version": 1,
            },
            parameters={"target_offer_id": target_offer_id},
            consequences=["Le changement prend effet à la prochaine échéance."],
            expires_at=utcnow() + timedelta(minutes=15),
            approval="self",
            origin="assistant",
        )
        db.add(row)
        db.commit()
        return {"status": "APPROVAL_REQUIRED", "proposal_id": row.id, "expires_at": iso(row.expires_at)}


@commerce_mcp.tool()
def prepare_cancellation(context_token: str, subscription_id: str) -> dict[str, Any]:
    """Prepare a cancellation proposal; execution requires human confirmation."""
    context = verify_context(context_token, "commerce", "subscriptions:write")
    with SessionLocal() as db:
        subscription = db.scalar(
            select(Subscription).where(
                Subscription.id == subscription_id, Subscription.user_id == context["sub"]
            )
        )
        if not subscription:
            raise DomainError(404, "NOT_FOUND", "Abonnement introuvable.")
        row = Proposal(
            actor_id=context["sub"],
            type="cancel_subscription",
            status="pending",
            title="Résilier à la fin de la période",
            resource={
                "type": "subscription",
                "id": subscription.id,
                "label": subscription.offer_snapshot["title"],
                "version": 1,
            },
            parameters={},
            consequences=[f"Accès maintenu jusqu'au {iso(subscription.current_period_end)}."],
            expires_at=utcnow() + timedelta(minutes=15),
            approval="self",
            origin="assistant",
        )
        db.add(row)
        db.commit()
        return {"status": "APPROVAL_REQUIRED", "proposal_id": row.id, "expires_at": iso(row.expires_at)}


@assistance_mcp.tool()
def search_terms(
    context_token: str, version: str, query: str = "", document_id: str = "vente"
) -> dict[str, Any]:
    """Search contractual terms for an exact version."""
    verify_context(context_token, "assistance", "documents:read")
    with SessionLocal() as db:
        document = db.scalar(
            select(ContractDocumentVersion).where(
                ContractDocumentVersion.document_id == document_id,
                ContractDocumentVersion.version == version,
            )
        )
        if not document:
            return {"status": "NOT_FOUND", "version": version, "passages": []}
        terms = query.casefold().split()
        sections = [
            section
            for section in document.sections
            if not terms
            or any(term in (section["title"] + " " + section["body"]).casefold() for term in terms)
        ]
        return {
            "status": "ok",
            "version": document.version,
            "passages": [
                {
                    "section_id": section["id"],
                    "title": section["title"],
                    "quote": section["body"][:500],
                    "href": f"/conditions/{document_id}?version={version}#{section['id']}",
                }
                for section in sections[:5]
            ],
        }


@assistance_mcp.tool()
def search_conditions(context_token: str, version: str, query: str = "") -> dict[str, Any]:
    """Search the exact effective contract version without substituting another version."""
    verify_context(context_token, "assistance", "documents:read")
    with SessionLocal() as db:
        document = db.scalar(
            select(ContractDocumentVersion).where(
                ContractDocumentVersion.document_id == "vente", ContractDocumentVersion.version == version
            )
        )
        if not document:
            return {"status": "not_found", "version": version, "passages": []}
        terms = query.casefold().split()
        sections = [
            section
            for section in document.sections
            if not terms
            or any(term in (section["title"] + " " + section["body"]).casefold() for term in terms)
        ]
        return {
            "status": "ok",
            "version": document.version,
            "passages": [
                {
                    "section_id": section["id"],
                    "title": section["title"],
                    "quote": section["body"][:500],
                    "href": f"/conditions/vente?version={version}#{section['id']}",
                }
                for section in sections[:5]
            ],
        }


@assistance_mcp.tool()
def diagnose_access(context_token: str, edition_id: str) -> dict[str, Any]:
    """Diagnose access using the asserted reader and current authoritative rights."""
    context = verify_context(context_token, "assistance", "access:diagnose")
    with SessionLocal() as db:
        edition = db.get(Edition, edition_id)
        if not edition:
            return {"status": "not_found", "reason": "EDITION_NOT_FOUND"}
        publication = db.get(Publication, edition.publication_id)
        rights = active_entitlements(db, context["sub"])
        matching = [
            row.id
            for row in rights
            if row.scope.get("edition_id") == edition_id or row.scope.get("universe") == publication.universe
        ]
        return {
            "status": "allowed" if edition.is_free or matching else "denied",
            "matching_entitlement_ids": matching,
            "edition_status": edition.status.value,
        }


@assistance_mcp.tool()
def get_authorized_excerpt(
    context_token: str,
    query: str,
    document_id: str | None = None,
    version: str | None = None,
    limit: int = 3,
) -> dict[str, Any]:
    """Search indexed passages with ACL revalidation; citations are server-built."""
    context = verify_context(context_token, "assistance", "documents:read")
    settings = get_settings()
    provider = provider_from_settings(settings)
    with SessionLocal() as db:
        if document_id and version:
            fixed = db.scalar(
                select(ContractDocumentVersion).where(
                    ContractDocumentVersion.document_id == document_id,
                    ContractDocumentVersion.version == version,
                )
            )
            if fixed:
                return search_terms(context_token, version=version, query=query, document_id=document_id)
        if not provider.status().configured:
            return {"status": "PROVIDER_UNAVAILABLE", "passages": [], "reason": "AI_NOT_CONFIGURED"}
        try:
            rows = RetrievalIndex(settings, provider).search(
                db, context["sub"], query, limit=max(1, min(limit, 6))
            )
        except Exception:
            return {"status": "NOT_FOUND", "passages": [], "reason": "INDEX_UNAVAILABLE"}
        passages = [
            {
                "passage_id": row.id,
                "document_id": row.document_id,
                "version": row.version,
                "section": row.page_or_section,
                "quote": row.text[:500],
                "href": f"/lecteur/{row.document_id}?version={row.version}#{row.page_or_section}",
            }
            for row in rows
        ]
        return {"status": "ok" if passages else "NOT_FOUND", "passages": passages}


@assistance_mcp.tool()
def create_support_case(context_token: str, subject: str, category: str, body: str) -> dict[str, Any]:
    """Create a support ticket for the asserted reader."""
    context = verify_context(context_token, "assistance", "support:write")
    with SessionLocal() as db:
        user = db.get(User, context["sub"])
        row = persist_support_case(db, user, subject=subject[:200], category=category[:60], body=body[:4000])
        db.commit()
        return {"status": "ok", "case": case_summary(db, row)}


@assistance_mcp.tool()
def get_my_case(context_token: str, case_id: str) -> dict[str, Any]:
    """Read one support case owned by the reader."""
    context = verify_context(context_token, "assistance", "support:read")
    with SessionLocal() as db:
        from app.db.models import SupportCase

        row = db.scalar(
            select(SupportCase).where(SupportCase.id == case_id, SupportCase.requester_id == context["sub"])
        )
        if not row:
            raise DomainError(404, "NOT_FOUND", "Demande introuvable.")
        return {"status": "ok", "case": case_summary(db, row)}


class _ClosedToolArguments:
    def __init__(self, allowed: dict[str, set[str]]):
        self.allowed = allowed

    async def __call__(self, ctx: ServerRequestContext[Any, Any], call_next: CallNext) -> HandlerResult:
        if ctx.method == "tools/call" and ctx.params:
            name = ctx.params.get("name")
            arguments = ctx.params.get("arguments") or {}
            if isinstance(name, str) and isinstance(arguments, dict):
                extra = set(arguments) - self.allowed.get(name, set())
                if extra:
                    raise MCPError(INVALID_PARAMS, f"Unknown tool arguments: {', '.join(sorted(extra))}")
        return await call_next(ctx)


def _install_closed_schemas(server: MCPServer) -> None:
    tools = server._tool_manager._tools  # SDK 2.0 registry, pinned in pyproject.toml.
    allowed: dict[str, set[str]] = {}
    for name, tool in tools.items():
        properties = tool.parameters.get("properties", {})
        tool.parameters["additionalProperties"] = False
        allowed[name] = set(properties)
    server.middleware.insert(0, _ClosedToolArguments(allowed))


for _server in (catalog_mcp, commerce_mcp, assistance_mcp):
    _install_closed_schemas(_server)
