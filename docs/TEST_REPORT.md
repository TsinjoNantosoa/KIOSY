# Rapport de tests exécutés

Date : 2 octobre 2026 (session agent).

## Backend (PostgreSQL local Docker, `KIOSY_LLM_PROVIDER=deterministic`)

| Test | Commande | Résultat |
|------|----------|----------|
| Suite complète | `cd backend && pytest -q` | **10 passed** |
| MCP discovery/call | `test_mcp.py` | pass |
| Multi-agent + MCP | `test_orchestration_mcp.py` | pass |
| Worker reprise | `test_worker.py` | pass |
| Quota 100 concurrents | `test_quota_concurrency.py` | pass |
| Paiement tardif/dupliqué | `test_payment_edges.py` | pass |
| RAG ACL | `test_rag.py` | pass |
| Proposition expirée 409 | `test_proposals.py` | pass |
| Flux API / idempotence | `test_api_flow.py` | pass |

## Frontend

| Test | Commande | Résultat |
|------|----------|----------|
| Typecheck | `npm run typecheck` | **pass** |
| Vitest | `npm test -- --run` | **8 failed**, 40 passed (échecs existants checkout/catalogue demo — non modifiés dans cette passe) |

## Non exécuté

- Playwright E2E complet frontend → KIA → MCP
- Azure OpenAI live
- Déploiement Render/Vercel
