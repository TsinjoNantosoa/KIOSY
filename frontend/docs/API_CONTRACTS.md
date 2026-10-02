# Contrats API attendus du backend

Les types sont dans [`src/contracts/models.ts`](../src/contracts/models.ts) et l'interface complète dans [`src/services/api/types.ts`](../src/services/api/types.ts) ; l'adaptateur HTTP est [`src/services/api/http.ts`](../src/services/api/http.ts). **Aucun OpenAPI n'existait** : tous les contrats ci-dessous sont des **propositions** à remplacer par les types générés (API01). Les endpoints marqués ◆ sont ceux nommés par le cahier des charges (section 17).

## Conventions

- Préfixe `/v1`, JSON, snake_case. Dates ISO 8601 UTC.
- Montants : `{ "amount": 15000, "currency": "MGA", "scale": 0 }` (entier, `scale` = décimales). Aucun flottant.
- Erreurs : `{ "code": "OFFER_CHANGED", "message": "...", "request_id": "...", "details": [{ "field": "...", "issue": "..." }] }` avec 401/403/404/409/422/429/503. Un 404 peut masquer une ressource non autorisée.
- Mutations sensibles : en-tête `Idempotency-Key` (même clé + même corps = résultat initial ; même clé + corps différent = 409 `IDEMPOTENCY_MISMATCH`).
- Listes : `{ items, page, page_size, total }`, pagination bornée, tri stable.
- Session : cookies HttpOnly/Secure + `credentials: "include"` ; CSRF en double-submit (cookie lisible `kiosy_csrf` renvoyé dans `X-CSRF-Token` sur les méthodes non sûres). Aucun jeton lu ni stocké par le navigateur.

## Endpoints

| | Méthode et route | Requête → réponse | Auth | Notes / dépendance |
|---|---|---|---|---|
| ◆ | `GET /v1/publications` | `q, universe, language, format, price (free|paid), sort, page, page_size` → `CatalogPage` (items + `facets`) | public | seules les éditions `published` |
| | `GET /v1/publications/featured` | → `CatalogItem[]` | public | sélection de l'accueil |
| | `GET /v1/publications/{id\|slug}` | → `PublicationDetail` (éditions publiées + offres applicables) | public | 404 si aucune édition publiée |
| | `GET /v1/editions/{id}/excerpt` | → `Excerpt` | public | 403 si extrait non autorisé ; jamais le fichier complet |
| | `GET /v1/editions/{id}/asset` | → `{ asset_id }` | session | pont vers `assets/{id}/access` (peut être fusionné) |
| ◆ | `GET /v1/assets/{id}/access` | → `AssetAccess` (URL signée courte, `download_allowed`, `title`, `edition_label`, `publication_slug`, `format`) | session | contrôle d'entitlement à chaque appel ; 403 `ACCESS_EXPIRED` / `ACCESS_DENIED` |
| | `GET /v1/offers` | `publication_id?` → `Offer[]` | public | |
| ◆ | `GET /v1/offers/{id}` | → `Offer` | public | |
| ◆ | `GET /v1/me/library` | → `LibraryItem[]` | session | éditions + droit source |
| | `GET /v1/me/access?publication_id=` | → `AccessSummary` | session | |
| | `GET /v1/me/eligibility?offer_ids=a,b` | → `Eligibility[]` | session | doublons, chevauchements, `PENDING_ORDER` |
| | `POST /v1/orders/quote` | `{ offer_id, renewal_of_subscription_id? }` → `Quote` | public/session | prix, dates, éligibilité calculés serveur |
| ◆ | `POST /v1/orders` | `{ offer_id, offer_version, renewal_of_subscription_id?, accepted_conditions_version }` → `Order` | session + Idempotency-Key | 409 `OFFER_CHANGED` / `OFFER_SOLD_OUT` / `ALREADY_OWNED` ; réservation de quota atomique (CON01) |
| | `GET /v1/orders/{id}` | → `Order` (statut **autoritaire**) | session | utilisé après retour du prestataire |
| ◆ | `POST /v1/orders/{id}/checkout` | → `CheckoutSession` (`redirect_url`) | session + Idempotency-Key | 409 `PAYMENT_PENDING` / `RESERVATION_EXPIRED` |
| | `GET /v1/me/orders`, `GET /v1/me/subscriptions[/{id}]`, `GET /v1/me/sessions`, `DELETE /v1/me/sessions/{id}`, `PATCH /v1/me/preferences` | voir types | session | |
| | `GET /v1/orders/{id}/receipt` | → fichier | session | lien affiché seulement si `receipt_available` |
| | `POST /v1/auth/{login,register,logout,password/forgot,password/reset}`, `GET /v1/auth/session` | → `Session` | — | réponse identique pour `forgot` que le compte existe ou non |
| ◆ | `POST /v1/conversations/{id}/runs` | `{ text }` → **202** `StartRunResponse` | session + Idempotency-Key | 409 `RUN_IN_PROGRESS` |
| | `GET/POST /v1/conversations`, `GET /v1/conversations/{id}[/messages]` | → `Conversation`, `Message[]` | session | `active_run_id` permet la reprise après rechargement |
| ◆ | `GET /v1/runs/{id}` | → `AgentRun` | propriétaire/rôle | |
| ◆ | `GET /v1/runs/{id}/events?after_seq=` | **SSE** (`message` = `RunEvent` JSON) ou JSON `RunEvent[]` en polling | propriétaire | numéro de séquence croissant ; reprise par `after_seq` ; `completed` = résultat persisté |
| | `POST /v1/runs/{id}/cancel` | → `AgentRun` | propriétaire | n'annule pas une opération déjà exécutée |
| ◆ | `POST /v1/proposals/{id}/confirm` | (corps vide) → `ActionProposal` | session + Idempotency-Key | 409 `PROPOSAL_EXPIRED` / `PROPOSAL_STALE` / `PROPOSAL_ALREADY_DECIDED` ; 403 `APPROVAL_REQUIRED` ; le serveur revalide prix, version, droits, échéance (SAFE01-03) |
| ◆ | `POST /v1/proposals/{id}/reject` | → `ActionProposal` | session + Idempotency-Key | |
| | `GET /v1/proposals/{id}` | → `ActionProposal` | propriétaire/approbateur | |
| | `POST /v1/subscriptions/{id}/cancellation-proposals` | → `ActionProposal` | session | SUB05 |
| | `POST /v1/subscriptions/{id}/plan-change-proposals` | `{ target_offer_id }` → `ActionProposal` | session | SUB06, sans prorata |
| | `GET/POST /v1/me/support-cases`, `GET /v1/support-cases/{id}`, `POST /v1/support-cases/{id}/messages` | voir types | session + Idempotency-Key | |
| | `GET /v1/admin/ops`, `publishers`, `editions[/{id}]`, `POST publications`, `PATCH publications/{id}`, `PATCH editions/{id}` (`version`), `POST editions/{id}/transitions`, `offers[/{id}/versions]`, `imports` (multipart), `orders`, `orders/{id}/reconcile`, `subscriptions`, `users`, `entitlements?user_id=`, `support-cases[/{id}/messages]`, `support-cases/{id}/access-exceptions`, `approvals`, `approvals/{id}/decision`, `audit-events`, `runs[/{id}]` | voir types | rôles (IAM01) | 409 `VERSION_CONFLICT`, `INVALID_TRANSITION`, `ASSET_NOT_READY`, 403 `SELF_APPROVAL_FORBIDDEN` |
| ◆ | `POST /v1/webhooks/payments/{provider}` | — | **serveur uniquement** | jamais appelé par le navigateur |

## Attentes côté serveur que le frontend ne garantit pas

Quota atomique, déduplication des événements du prestataire, vérification de signature, revalidation des droits, isolation éditeur/lecteur, autorisation MCP, limites de débit : **contrôles backend** (les tests du frontend ne les prouvent pas).

## Compléments de la revue frontend du 1er octobre 2026

- `GET /v1/auth/csrf` remet `{ token }` en JSON. Le jeton reste en mémoire et est envoyé dans `X-CSRF-Token`; l'application ne lit pas un cookie appartenant au domaine API.
- `POST /v1/admin/offers` reçoit `OfferCreateInput` et retourne l'offre v1.
- `POST /v1/admin/publications/{id}/editions` reçoit `EditionInput` et ajoute une édition sans remplacer les précédentes.
- `GET /v1/contract-documents/{id}/versions/{version}` retourne le document exact, sa provenance et ses sections.
- Ces endpoints sont proposés et non implémentés côté backend. Voir `BACKEND_HANDOFF.md`.
