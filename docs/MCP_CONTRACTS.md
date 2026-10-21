# Contrats MCP — Kiosy MVP

Trois applications Streamable HTTP montées sur l’API :

| Serveur | Chemin | Audience |
|---------|--------|----------|
| kiosy-catalog | `/mcp/catalog/` | `catalog` |
| kiosy-commerce | `/mcp/commerce/` | `commerce` |
| kiosy-assistance | `/mcp/assistance/` | `assistance` |

Chaque appel exige un `context_token` signé (audience, scopes, `sub`, expiration ~120 s). Aucun `user_id` libre n’est accepté.

## Catalogue

| Outil | Scope | Mutation |
|-------|-------|----------|
| `search_publications` | `catalog:read` | non |
| `get_publication` | `catalog:read` | non |
| `get_offer` | `catalog:read` | non |
| `compare_offers` | `catalog:read` | non |
| `get_contract_excerpt` | `catalog:read` | non |

## Commerce

| Outil | Scope | Mutation |
|-------|-------|----------|
| `get_my_subscriptions` / `list_my_subscriptions` | `subscriptions:read` | non |
| `read_my_entitlements` | `entitlements:read` | non |
| `check_entitlement` | `entitlements:read` | non |
| `prepare_purchase` | `purchase:prepare` | proposition persistée |
| `prepare_plan_change` | `subscriptions:write` | proposition |
| `prepare_cancellation` | `subscriptions:write` | proposition |

Codes métier courants : `ACCESS_DENIED`, `NOT_FOUND`, `APPROVAL_REQUIRED`, `ALREADY_OWNED`, `OFFER_SOLD_OUT`.

## Assistance

| Outil | Scope | Mutation |
|-------|-------|----------|
| `search_terms` / `search_conditions` | `documents:read` | non |
| `search_authorized_content` / `get_authorized_excerpt` | `documents:read` | non (RAG hybride + ACL) |
| `diagnose_access` | `access:diagnose` | non |
| `create_support_case` | `support:write` | oui |
| `get_my_case` | `support:read` | non |

## Client KIA

`app/mcp/invoke.py` — `KiosyMcpClients` : découverte implicite, invocation via SDK MCP officiel, journal `mcp_invocations` (outil, trace_id, statut).

Tests : `tests/test_mcp.py` (client indépendant), `tests/test_orchestration_mcp.py` (graphe LangGraph).
