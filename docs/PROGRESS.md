# Progression MVP P0 — Kiosy

Dernière mise à jour : 7 octobre 2026. Source métier : `Cahier_des_charges_Kiosy_v1.pdf`, versionné dans le dépôt (SHA-256 vérifié : `DF894BEAF66463B3015962DD1B72EFA5819CE6044021118C5213FD16B3B9DBB9`).

| Exigence | Module | Implémentation | Test | État |
|----------|--------|----------------|------|------|
| Frontend catalogue / commerce / KIA / admin | `frontend/` | React 18, modes demo + api | 48 Vitest + 22 Playwright + 2 builds | DONE |
| API FastAPI persistante | `backend/app` | 88 routes OpenAPI | `test_api_flow.py` | DONE |
| Auth session + CSRF + rôles | `core/security`, `api/auth` | cookies HttpOnly | `test_api_flow.py` | DONE |
| Commerce idempotent + quota PG | `commerce_service` | devis, commande, test payment | `test_quota_concurrency.py`, `test_payment_edges.py` | DONE |
| Fichiers privés S3 | `domains/storage` | URLs signées | partiel offline | PARTIAL |
| RAG Qdrant + ACL | `ai/retrieval` | index + revalidation + namespace embedding | `test_rag.py` | DONE |
| 3 serveurs MCP Streamable HTTP | `mcp/servers.py` | `/mcp/{catalog,commerce,assistance}` | `test_mcp.py` | DONE |
| KIA → clients MCP réels | `mcp/invoke.py`, `ai/orchestration.py` | spécialistes via `mcp.Client` | `test_orchestration_mcp.py`, `test_worker.py` | DONE |
| Multi-agent coopératif | LangGraph | catalogue → droits → conditions | `test_worker.py` | DONE |
| Worker durable + reprise | `workers/runner.py` | lease, heartbeat, fencing, retry, outbox | `test_worker.py` | DONE |
| SSE runs | `api/assistant.py` | seq + heartbeat + polling | manuel / E2E | PARTIAL |
| Propositions + 409 expiré | `api/proposals.py` | revalidation serveur | `test_proposals.py` | DONE |
| Reprise run après approbation KIA | assistant + worker | `Command(resume=...)` sur le même thread | `test_worker.py` | DONE |
| Audit trail | `domains/audit.py` | auth, commerce, support, admin, propositions | `test_audit.py` + tests API | DONE |
| Limites IA appliquées | config + orchestration | outils, LLM, tokens, temps, débit, concurrence | `test_orchestration_mcp.py` | DONE |
| Azure OpenAI live | `ai/providers.py` | adaptateur + opt-in | BLOCKED_EXTERNAL | BLOCKED_EXTERNAL |
| Déploiement Render/Vercel | `render.yaml`, `frontend/vercel.json` | config sécurisée et validée statiquement | déploiement réel non exécuté | BLOCKED_EXTERNAL |
| Dataset 80 scénarios IA | dataset + harnais déterministe | 7 catégories réelles | 80/80 offline | DONE |
| 15 cas recette T01–T15 | tests + docs | couverture partielle automatisée | voir `docs/TEST_REPORT.md` | PARTIAL |

## Travail de cette passe

### Phase 0 — audit et baseline du 7 octobre 2026

- `git status` propre sur `main`, synchronisé avec `origin/main` au début de la passe.
- Cahier des charges relu intégralement : 29 pages. README, ADR, contrats MCP, rapports racine et documentation frontend inspectés.
- Backend : Python 3.12.10 ; `compileall` et Ruff passent. MyPy est `BLOCKED_ENVIRONMENT` par une politique Windows qui bloque le chargement d'une DLL de MyPy.
- PostgreSQL 16 et Qdrant démarrés via Docker. Alembic est en révision `0001 (head)`. Les 10 tests backend passent sur PostgreSQL réel lorsque `KIOSY_DATABASE_URL` est explicitement fourni ; sans cette variable, les 10 tests sont correctement ignorés par leur fixture.
- Frontend : TypeScript passe ; ESLint passe avec 12 avertissements historiques ; les builds `demo` et `api` passent.
- Frontend Vitest : **47/48 passent, 1 échec réel** sur la protection contre un double clic de création de commande. La phase 1 doit corriger le code, sans modifier l'assertion.
- `npm ci` a échoué sur Windows avec `ENOTEMPTY` dans `node_modules`; `npm install` a réparé l'arbre local. Ce point reste une anomalie d'environnement à revalider en CI propre.
- Le `docker compose up -d` complet est bloqué par le tag inexistant `minio/mc:RELEASE.2025-07-21T05-28-08Z`; PostgreSQL et Qdrant restent utilisables. Correction à traiter dans la phase d'infrastructure.
- Écarts P0 confirmés par inspection : migration `0001` dynamique via `Base.metadata.create_all`, absence de branches LangGraph persistantes `waiting_user` / `waiting_approval`, tests HTTP MCP distants non prouvés, audit et limites seulement partiels.

Statut phase 0 : **TERMINÉE AVEC ÉCARTS DOCUMENTÉS**. La baseline ne revendique ni déploiement ni validation Azure live.

### Phase 1 — régression frontend

- Course de double-clic checkout reproduite (2 appels `createOrder`) puis corrigée par un verrou synchrone conservé après succès jusqu'à la navigation.
- Validation : TypeScript passe ; ESLint 0 erreur/12 avertissements ; Vitest 48/48 ; builds `demo` et `api` passent.
- Playwright : 22/22 passent sur Chromium local avec 2 workers. Un premier lancement à 6 workers avait subi un timeout KIA (21/22), puis le cas isolé et la suite complète à concurrence réduite ont passé.
- Les rapports contradictoires 40/48 et 48/48 ont été remplacés par la baseline datée et le résultat après correction.

Statut phase 1 : **TERMINÉE**.

### Phase 2 — `waiting_user`, `waiting_approval` et reprise

- `waiting_user` utilise une interruption LangGraph persistée. La réponse utilisateur reprend le même `thread_id` par `Command(resume=...)`; elle ne crée pas un second run.
- `waiting_approval` est produit après `prepare_purchase`. Le run et la proposition sont liés, puis la confirmation revalide empreinte, acteur, offre, version, prix, devise, conditions et entitlement avant de créer une commande.
- Une confirmation répétée retourne le premier résultat et ne crée pas une seconde commande. Après décision, le worker reprend le checkpoint et termine le run.
- Preuve automatisée : `test_waiting_user_resumes_same_langgraph_thread` et `test_waiting_approval_revalidates_executes_once_and_resumes`.

Statut phase 2 : **TERMINÉE**.

### Phase 3 — spécialiste support

- L'intention support est reliée à un nœud dédié. Il recherche la ressource, appelle `diagnose_access`, lit les abonnements et ne crée ni droit ni contournement d'accès.
- Si l'édition n'est pas identifiable ou l'accès reste refusé, le résultat propose seulement une création de ticket soumise à confirmation.
- Preuve automatisée : `test_support_intent_routes_to_dedicated_specialist`.

Statut phase 3 : **TERMINÉE**.

### Phase 4 — MCP Streamable HTTP et schémas fermés

- Le mode MCP in-process est conservé pour les tests rapides et KIA.
- Un second client indépendant lance un vrai Uvicorn sur TCP et valide `initialize`, `list_tools` et `call_tool` via `/mcp/catalog/`, `/mcp/commerce/` et `/mcp/assistance/`.
- Le test couvre mauvaise audience, outil inconnu et argument supplémentaire. Une lacune SDK confirmée (champs inconnus ignorés) est compensée par un middleware pré-validation et des schémas `additionalProperties: false`.
- La protection DNS-rebinding accepte les ports explicites uniquement pour les hôtes locaux configurés; les autres hôtes restent en liste fermée.

Statut phase 4 : **TERMINÉE**.

### Phase 5 — limites globales du run

- Le compteur d'outils est global au run, propagé entre tous les spécialistes. Les `tool_call_id` suivent la séquence monotone `<trace_id>:<n>` et sont uniques.
- Limites effectivement appliquées : délégations, outils, appels LLM, temps actif, taille du message, tokens estimés, quota horaire, concurrence par utilisateur et concurrence globale.
- L'attente humaine n'entre pas dans le temps actif : un nouveau segment actif démarre à la reprise. Les compteurs et estimations sont persistés dans le checkpoint; le coût est explicitement marqué `ESTIMATED`.
- La déduplication des candidats MCP et la recherche contractuelle bornée maintiennent le parcours composé sous le plafond de 12 outils.

Statut phase 5 : **TERMINÉE**.

### Phase 6 — worker durable, fencing, retry et outbox

- Chaque prise de tâche reçoit un jeton de bail unique. Le heartbeat renouvelle le bail pendant le traitement et toutes les écritures finales vérifient le propriétaire : un ancien worker ne peut plus terminer une tâche reprise par un autre.
- Une erreur transitoire remet la tâche et son run en file avec délai exponentiel. Le statut `failed` n’est posé qu’après épuisement de `max_attempts`.
- Le dispatcher outbox verrouille les événements non publiés avec `SKIP LOCKED` et les marque après commit. Les topics P0 sont des signaux internes ; toute intégration externe devra fournir un consommateur idempotent avant d’être déclarée livrée.
- Preuve automatisée : abandon/reprise, heartbeat, retry non terminal, fencing obsolète et récupération outbox dans `test_worker.py`.

Statut phase 6 : **TERMINÉE**.

### Phase 7 — namespace RAG versionné

- L’espace vectoriel inclut désormais la version de namespace, le fournisseur et le vrai déploiement d’embeddings Azure, indépendamment du déploiement de génération.
- Un changement de modèle/déploiement produit une nouvelle collection Qdrant ; les vecteurs incompatibles ne peuvent plus être mélangés silencieusement.
- Preuve automatisée : deux déploiements d’embeddings Azure distincts produisent deux espaces et collections distincts dans `test_rag.py`.

Statut phase 7 : **TERMINÉE**.

### Phase 8 — audit, débit et budgets

- L’audit couvre les mutations majeures d’authentification/session, commande/paiement, support, administration éditoriale, approbations et propositions.
- Les métadonnées d’audit sont filtrées récursivement : mots de passe, tokens, cookies, secrets, autorisations, cartes et URLs signées sont remplacés par `[REDACTED]`.
- Les budgets tokens, appels LLM et temps actif échouent avant le travail coûteux ; les limites de débit et de concurrence sont appliquées lors de la création et de la reprise des runs.
- Preuves : `test_audit.py`, tests paramétrés de budgets et suite backend complète, **20/20 passent**.

Statut phase 8 : **TERMINÉE**.

### Phase 9 — migration Alembic explicite

- `0001_initial.py` ne dépend plus de `Base.metadata.create_all/drop_all` : toutes les tables, contraintes, index, clés étrangères et enums PostgreSQL sont déclarés explicitement.
- Validation sur base PostgreSQL vierge : `upgrade head`, `alembic check`, `downgrade base`, second `upgrade head`, second `alembic check` passent sans dérive. Le schéma de checkpoints LangGraph est ensuite créé par son script dédié.
- La base existante reste à la révision `0001`; aucun historique déjà déployé n’est réécrit côté serveur pendant cette validation locale.

Statut phase 9 : **TERMINÉE**.

### Phase 10 — benchmark IA réel

- Les 80 placeholders ont été remplacés par 80 demandes métier distinctes : 15 recommandations, 15 accès/abonnements, 10 conditions documentaires, 10 composées, 10 ambiguës/hors corpus, 10 attaques/interdits et 10 erreurs de dépendance.
- Chaque cas possède acteur, état initial, outils et sources autorisés, résultat métier, effets autorisés/interdits, statut et notes. Le schéma est fermé et la distribution est vérifiée à l’exécution.
- Le harnais exécute réellement le graphe multi-agent avec le provider déterministe (ou le provider indisponible pour les pannes), contrôle outils, sources, citations, refus, effets et compte les métriques observées.
- Exécution du 7 octobre 2026 : **80/80 passent**, 323 appels outils, 117 appels LLM déterministes, 5 105 tokens d’entrée estimés, 4 553 de sortie, coût estimé 0, durée cumulée mesurée 12 336,449 ms. Aucun score Azure live n’est inventé.
- La comparaison avec un « agent unique » n’est pas publiée : cette architecture n’existe pas dans le dépôt et aucun score comparable n’a donc été fabriqué.

Statut phase 10 : **TERMINÉE OFFLINE** ; Azure live reste **BLOCKED_EXTERNAL**.

### Phase 11 — intégration continue

- Ajout de `.github/workflows/ci.yml` avec trois jobs : backend sur PostgreSQL/Qdrant (migration, checkpointer, seed, Ruff, MyPy, Pytest), frontend (`npm ci`, typecheck, lint, Vitest, builds demo/API) et Playwright séparé.
- Aucun secret réel n’est versionné ; les valeurs CI sont locales au job et le fournisseur Azure live n’est pas appelé.
- Les YAML CI/Render et `docker compose config` ont été parsés localement. Ruff passe. MyPy reste `BLOCKED_ENVIRONMENT` localement par la politique Windows ; le job Linux est la preuve attendue après push GitHub.

Statut phase 11 : **IMPLÉMENTÉE, EXÉCUTION GITHUB BLOCKED_EXTERNAL**.

### Phase 12 — Render, Vercel et stockage local

- Render initialise désormais Alembic **et** les checkpoints LangGraph dans un unique pre-deploy API. API et worker partagent base, secret généré et configuration via groupe/références de service ; seul l’API migre.
- Les valeurs production sensibles sont demandées dans Render puis référencées par le worker. Cookies `Secure`/`SameSite=None`, paiement test désactivé, CORS exact, endpoints HTTPS et délais d’arrêt gracieux sont explicites.
- Un validateur refuse en production les fallbacks localhost/HTTP, Mailpit, identifiants stockage absents, cookies non sûrs et paiement test actif.
- `vercel.json` conserve le build Vite, le fallback SPA et les en-têtes de sécurité ; `VITE_APP_MODE=api` et les URLs publiques doivent être fournis dans le dashboard Vercel.
- Les images officielles MinIO ont été retirées des registres en septembre 2026. Compose cible désormais `adobe/s3mock:5.1.0`, S3-compatible et épinglé. Son téléchargement local a expiré dans l’environnement courant : validation runtime stockage **BLOCKED_ENVIRONMENT**.

Statut phase 12 : **CONFIGURATION VALIDÉE STATIQUEMENT** ; déploiements Render/Vercel et pull S3Mock restent **BLOCKED_EXTERNAL/BLOCKED_ENVIRONMENT**.

### Phase 13 — recette T01 à T15

- La matrice détaillée est versionnée dans `docs/REQUIREMENTS_MATRIX.md` et relie chaque exigence à une preuve réellement exécutée.
- Les trous T02, T11 et T12 ont reçu des tests dédiés : paiement jusqu’à la bibliothèque, résiliation avec maintien du droit à l’échéance et retrait simultané du catalogue/de la vente/RAG.
- T15 a été exercé sur PostgreSQL local réel : dump custom, restauration dans une base temporaire, 35 tables et 2 130 utilisateurs identiques, puis nettoyage de la base et du dump temporaires.

Statut phase 13 : **15/15 PASS EN ENVIRONNEMENT LOCAL**. Les validations cloud restent hors de ce dénominateur et sont conservées séparément.

### Phase 14 — trois démonstrations principales

- Achat/recommandation : run durable multi-spécialistes, MCP catalogue/commerce/conditions, proposition, confirmation idempotente, reprise du checkpoint, commande unique ; puis paiement/droit/bibliothèque dans T02.
- Support : diagnostic par spécialiste dédié, appels MCP d’accès et d’abonnements, puis création d’un ticket uniquement sur demande explicite ; référence `SUP-*` vérifiée.
- Abonnement : « Je veux arrêter mon abonnement » appelle les abonnements, prépare une proposition MCP, interrompt en `waiting_approval`, confirme côté service métier, reprend le même thread et programme la résiliation.
- Ces trois chaînes sont prouvées au niveau backend réel (PostgreSQL/LangGraph/MCP/worker). Le frontend Playwright existant est prouvé séparément en mode démo ; un navigateur API hébergé complet reste `BLOCKED_EXTERNAL` jusqu’au déploiement.

Statut phase 14 : **PASS BACKEND INTÉGRÉ**, **E2E NAVIGATEUR API BLOCKED_EXTERNAL**.

### Phase 15 — documentation et validation finale

- README et documents architecture, API, MCP, multi-agent, RAG, sécurité, limites, déploiement, opérations, recette et tests ont été alignés sur l’état réellement vérifié le 7 octobre 2026.
- `docs/TEST_REPORT.md` est la source principale des totaux ; les rapports frontend conservent le détail et l’historique daté.
- Validation finale : backend Ruff/compile/29 tests passent ; frontend typecheck, lint (0 erreur/12 avertissements), 48 Vitest, deux builds et 22 Playwright passent.
- Les seuls blocages restants sont explicitement externes/environnementaux : Azure live, run GitHub Actions, déploiement Render/Vercel, navigateur API hébergé, pull S3Mock local et MyPy Windows.

Statut phase 15 : **TERMINÉE**.

## Prochaine étape

- Exécuter le workflow GitHub Actions après push.
- Fournir les comptes/secrets pour Azure, Qdrant, stockage, SMTP, Render et Vercel puis exécuter le pilote hébergé.
- Exécuter le navigateur en mode API contre ce pilote, puis réaliser les tests commerciaux d’un futur prestataire de paiement réel.
