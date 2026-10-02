# Système multi-agent KIA

## Graphe LangGraph (`app/ai/orchestration.py`)

```
START → coordinate (intent LLM)
  ├─ catalog → [subscriptions] → [conditions] → compose → END
  ├─ conditions → compose
  └─ compose (direct)
```

Spécialistes MVP :

1. **Catalogue** — MCP `search_publications`, `get_publication`, `compare_offers`.
2. **Abonnements / droits** — MCP `check_entitlement`, `get_my_subscriptions` ; filtre les offres déjà couvertes (entrée = sortie catalogue).
3. **Conditions** — MCP `search_terms` sur les versions d’offres restantes ; repli contrat `mvp-2026-10-01` puis `get_authorized_excerpt` (RAG).

## AgentResult

Schéma Pydantic : `status` ∈ {ok, needs_input, blocked, failed}, `summary`, `evidence_refs`, `proposed_actions`, `missing_information`, `warnings`, `trace_id`, `mcp_tools`.

## Coopération observable

Scénario de référence (worker + test) :

> « Compare les offres et abonnements, exclue ce qui est déjà couvert puis vérifie les conditions. »

Intent `cooperate` → trois spécialistes en chaîne ; les droits modifient la liste transmise au spécialiste conditions.

## Exécution durable

`POST /v1/conversations/{id}/runs` → `DurableTask` → `workers/runner.py` → `graph.invoke` avec checkpoint PostgreSQL (`thread_id` = run id).

États run : `queued`, `running`, `completed`, `failed`, `cancelled` ; `waiting_user` / `waiting_approval` prévus côté API mais reprise post-approbation KIA encore partielle.
