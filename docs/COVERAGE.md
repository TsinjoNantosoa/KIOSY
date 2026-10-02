# Matrice de couverture MVP

| Exigence | Module | API / outil | Preuve automatisée | État |
|---|---|---|---|---|
| Session, CSRF, rôles | `core/security.py`, `api/auth.py` | `/v1/auth/*`, `/v1/me/sessions` | `test_api_flow.py` | Implémenté, testé offline |
| Catalogue et documents versionnés | `catalog_service.py`, `api/catalog.py` | `/v1/publications`, `/v1/offers`, `/v1/contract-documents/*` | API flow + frontend typecheck | Implémenté |
| Administration éditoriale | `api/admin.py` | publications, éditions, transitions, versions d'offres, imports | lint/import; E2E manuel requis | Implémenté |
| Commandes, prix autoritaire, idempotence | `commerce_service.py`, `idempotency.py` | quote, order, checkout, operation recovery | `test_api_flow.py` | Implémenté, testé PostgreSQL |
| Quota atomique | `commerce_service.py` | création de commande | `test_quota_concurrency.py` (100 concurrents) | Implémenté, testé PostgreSQL |
| Paiement de test et droits | `api/commerce.py` | test payment complete/simulate | `test_payment_edges.py` (tardif + doublon) | Implémenté offline |
| Abonnements et propositions | `api/account.py`, `api/proposals.py` | `/me/subscriptions`, cancellation/change proposals | import/lint; E2E manuel requis | Implémenté |
| Support et approbations | `api/support.py`, `api/admin_views.py` | tickets, exceptions, décisions | séparation codée; E2E manuel requis | Implémenté |
| Fichiers privés et ingestion | `storage.py`, `workers/runner.py` | import, asset access | worker lease test; S3 E2E requis | Implémenté offline |
| RAG ACL/version/retrait | `ai/retrieval.py` | service interne | `test_rag.py` (Qdrant local, ACL, retrait) | Implémenté, testé offline |
| Multi-agent persistant | `ai/orchestration.py` | runs, events, SSE | `test_worker.py` (3 spécialistes) | Implémenté, testé déterministe |
| MCP v2 réel | `mcp/servers.py` | 3 transports Streamable HTTP | `test_mcp.py` client officiel | Implémenté, testé offline |
| Tâches durables et reprise | `workers/runner.py` | PostgreSQL lease/outbox/checkpoints | `test_worker.py` | Implémenté, testé PostgreSQL |
| Azure OpenAI | `ai/providers.py` | adaptateur + diagnostic | aucun appel sans opt-in | Implémenté, non validé live |
| Déploiement | Docker/Compose/Render | API + worker + services locaux | validation de config à exécuter | Configuré, pilote requis |
