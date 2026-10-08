# Matrice de recette P0 — 7 octobre 2026

Cette matrice ne compte comme `PASS` que les preuves exécutées pendant la passe courante. Les validations nécessitant un compte cloud ou des secrets réels restent explicitement bloquées.

| ID | Exigence | Preuve exécutée | Statut |
|---|---|---|---|
| T01 | Catalogue public, aucun draft/fichier privé | `test_csrf_rotation_catalog_order_and_idempotency`, `test_t12_withdrawal_stops_sale_catalog_and_rag` | PASS |
| T02 | Offre → devis → commande → paiement → droit → bibliothèque | `test_t02_paid_order_payment_entitlement_and_library` | PASS |
| T03 | Replay d’événement sans double effet | `test_duplicate_and_late_payment_never_oversell` | PASS |
| T04 | 100 concurrents pour une place | `test_one_last_place_under_100_concurrent_requests` : 1 gagnant, quota 0 | PASS |
| T05 | Expiration et paiement tardif sans survente | `test_expired_quote_and_client_price_are_rejected`, `test_duplicate_and_late_payment_never_oversell` | PASS |
| T06 | Isolation entre lecteurs et RAG privé | `test_cross_reader_order_access_is_hidden`, `test_rag_revalidates_acl_and_withdraws_content`, refus MCP audience | PASS |
| T07 | Multi-agent, au moins deux spécialistes et dépendance | `test_specialists_invoke_real_mcp_tools`, worker : 3 spécialistes | PASS |
| T08 | Injection documentaire / demande interdite | `test_forbidden_prompt_is_refused_without_tool_or_side_effect`, 10 attaques benchmark | PASS |
| T09 | Proposition expirée : 409 et possibilité de repréparer | `test_expired_proposal_returns_409`; création/confirmation idempotente couverte par worker et T11 | PASS |
| T10 | Reprise worker sans double effet | `test_abandoned_lease_is_reclaimed_and_multi_agent_run_completes`, fencing/retry/outbox | PASS |
| T11 | Résiliation à bonne date et historique | `test_t11_cancellation_keeps_history_and_period_end` | PASS |
| T12 | Retrait : plus de vente/catalogue/RAG | `test_t12_withdrawal_stops_sale_catalog_and_rag`, `test_rag_revalidates_acl_and_withdraws_content` | PASS |
| T13 | MCP HTTP discovery/call/refus/erreur structurée | `test_streamable_http_initialization_discovery_calls_and_security` sur 3 serveurs | PASS |
| T14 | Mobile catalogue/checkout/library/KIA | Playwright Chromium mobile 360 px, 2/2 scénarios mobiles dans la suite 22/22 | PASS |
| T15 | Sauvegarde/restauration | `pg_dump -Fc` → base temporaire → `pg_restore`; 35 tables, 2 130 utilisateurs source/restauration; base temporaire supprimée | PASS |

Résultat de la matrice locale : **15/15 PASS**. Cela ne vaut pas validation Azure live, déploiement Render/Vercel ni exercice de restauration sur l’infrastructure de production.
