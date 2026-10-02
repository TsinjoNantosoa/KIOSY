# Progression MVP P0 — Kiosy

Dernière mise à jour : 2 octobre 2026. Source métier : cahier des charges v1 (non versionné dans le dépôt ; le frontend `README.md` et les ADR dans `docs/ARCHITECTURE.md` en reprennent les décisions).

| Exigence | Module | Implémentation | Test | État |
|----------|--------|----------------|------|------|
| Frontend catalogue / commerce / KIA / admin | `frontend/` | React 18, modes demo + api | Vitest + build | DONE |
| API FastAPI persistante | `backend/app` | 88 routes OpenAPI | `test_api_flow.py` | DONE |
| Auth session + CSRF + rôles | `core/security`, `api/auth` | cookies HttpOnly | `test_api_flow.py` | DONE |
| Commerce idempotent + quota PG | `commerce_service` | devis, commande, test payment | `test_quota_concurrency.py`, `test_payment_edges.py` | DONE |
| Fichiers privés S3 | `domains/storage` | URLs signées | partiel offline | PARTIAL |
| RAG Qdrant + ACL | `ai/retrieval` | index + revalidation | `test_rag.py` | DONE |
| 3 serveurs MCP Streamable HTTP | `mcp/servers.py` | `/mcp/{catalog,commerce,assistance}` | `test_mcp.py` | DONE |
| KIA → clients MCP réels | `mcp/invoke.py`, `ai/orchestration.py` | spécialistes via `mcp.Client` | `test_orchestration_mcp.py`, `test_worker.py` | DONE |
| Multi-agent coopératif | LangGraph | catalogue → droits → conditions | `test_worker.py` | DONE |
| Worker durable + reprise | `workers/runner.py` | lease SKIP LOCKED | `test_worker.py` | DONE |
| SSE runs | `api/assistant.py` | seq + heartbeat + polling | manuel / E2E | PARTIAL |
| Propositions + 409 expiré | `api/proposals.py` | revalidation serveur | `test_proposals.py` | DONE |
| Reprise run après approbation KIA | assistant + worker | propositions MCP `prepare_*` ; pas de reprise LangGraph | — | PARTIAL |
| Audit trail | `domains/audit.py` | login, register, proposals | à étendre commerce | PARTIAL |
| Limites IA appliquées | config + orchestration | max_tool_calls, max_delegations | unitaire implicite | PARTIAL |
| Azure OpenAI live | `ai/providers.py` | adaptateur + opt-in | BLOCKED_EXTERNAL | BLOCKED_EXTERNAL |
| Déploiement Render/Vercel | docs | config présente | non exécuté | BLOCKED_EXTERNAL |
| Dataset ~80 scénarios IA | `backend/data/ai_eval_scenarios.jsonl` | fichier versionné | offline only | PARTIAL |
| 15 cas recette T01–T15 | tests + docs | couverture partielle automatisée | voir `docs/TEST_REPORT.md` | PARTIAL |

## Travail de cette passe

- Clients MCP (`KiosyMcpClients`) branchés sur les spécialistes LangGraph.
- Catalogue MCP étendu (publication, comparaison, extraits contractuels, commerce, assistance).
- Tests : `test_orchestration_mcp.py`, `test_proposals.py` ; worker stabilisé.
- Audit minimal sur auth et propositions.

## Prochaine étape

- Reprise de run `waiting_approval` après confirmation proposition KIA.
- E2E Playwright frontend ↔ API ↔ worker.
- Enrichir audit (commandes, paiements, admin).
- Validation Azure live et déploiement pilote.
