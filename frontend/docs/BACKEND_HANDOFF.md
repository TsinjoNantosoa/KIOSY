# Passage de relais au backend

Ce document décrit le contrat proposé par le frontend. Il ne signifie pas que le serveur existe ou qu'il a été validé. Les types sont dans `src/contracts/models.ts`, les schémas critiques dans `src/contracts/schemas.ts` et les routes dans `src/services/api/http.ts`.

## Authentification, domaines et CSRF

- Cible : `https://app.domaine` et `https://api.domaine`, ou les domaines Vercel/Render explicitement autorisés.
- Session par cookie API `HttpOnly`, `Secure`, avec attributs `SameSite`/`Domain` compatibles. Tous les appels utilisent `credentials: include`.
- Le frontend ne lit et ne supprime jamais le cookie de session. `POST /v1/auth/logout` le révoque côté serveur.
- `GET /v1/auth/csrf` renvoie `{ "token": "..." }`. Le frontend garde le jeton en mémoire et l'envoie dans `X-CSRF-Token` pour les méthodes non sûres. Il ne suppose pas que JavaScript sur `app.*` puisse lire un cookie de `api.*`.
- CORS autorise l'origine exacte, les credentials et les en-têtes `X-CSRF-Token`/`Idempotency-Key`; jamais `*` avec credentials. SSE accepte les credentials et la reprise par `after_seq`.
- `GET /v1/auth/session` renvoie 200 `Session`, 401 si l'absence/expiration est établie, 503 si la session est invérifiable.

## Endpoints attendus

La liste principale est dans `API_CONTRACTS.md`. Ajouts de cette passe :

- `GET /v1/auth/csrf` — jeton anti-CSRF en JSON ;
- `POST /v1/admin/offers` — version 1 d'une offre ;
- `POST /v1/admin/publications/{publication_id}/editions` — nouveau brouillon sans remplacer l'historique ;
- `GET /v1/contract-documents/{document_id}/versions/{version}` — document exact et sections adressables ;
- récupération d'une mutation incertaine à définir, par exemple `GET /v1/operations/by-idempotency-key/{key}`.

## Idempotence et résultat inconnu

- `Idempotency-Key` obligatoire pour commande, checkout, import, ticket/message et confirmation.
- Liaison serveur : acteur + opération + empreinte canonique du corps + résultat. Même clé/corps retourne le résultat initial ; corps différent retourne 409 `IDEMPOTENCY_MISMATCH`.
- Conservation serveur proposée : sept jours. Le frontend ne conserve qu'une clé, une empreinte et une date pendant 24 h dans `sessionStorage`, isolées par compte/opération. Pas de partage entre onglets.
- Après réponse perdue, vérifier d'abord une commande/opération existante. Aucun retry automatique aveugle.
- Nouvelle offre/version, intention abandonnée ou compte différent implique une nouvelle clé.

## Commandes et paiements

- Commande : `created`, `pending_payment`, `paid`, `fulfilled`, `cancelled`, `payment_exception`.
- Paiement : `initiated`, `pending`, `succeeded`, `failed`, `cancelled`, `refund_pending`, `refunded`.
- `mode` vaut `test`, `sandbox` ou `live` et commande les libellés. Le mode application `api` ne signifie pas `live`.
- Le retour navigateur n'est pas une preuve : `GET /v1/orders/{id}` est autoritaire. La réservation affiche seulement `reservation.expires_at`.
- Quota, unicité, webhooks, droits et compensation restent des invariants serveur transactionnels.

## Propositions et KIA

- Une proposition référence acteur, ressource/version, conséquences, conditions, montant et expiration. La confirmation revalide tout et consomme l'approbation une fois.
- Runs : `queued`, `running`, `waiting_user`, `waiting_approval`, `completed`, `failed`, `cancelled`. Les états d'attente restent suivis.
- SSE `/v1/runs/{id}/events?after_seq=n` : séquence croissante, validation de schéma et reprise sans doublon. « Direct » n'est affiché qu'après ouverture effective.
- Une coupure SSE déclenche le polling sans changer l'état métier. Annuler n'annule pas un effet déjà exécuté.

## Fichiers

- `GET /v1/assets/{id}/access` revalide le droit et retourne URL HTTPS courte, `expires_at` et `download_allowed` actuels.
- Origines configurées par `VITE_ASSET_ALLOWED_ORIGINS`; `blob:` est réservé à la démo. Le stockage fournit CORS et `Content-Disposition`, car l'attribut HTML `download` n'est pas fiable entre origines.
- 403 distingue accès refusé, expiré ou révoqué. Aucun cache partagé de réponse privée. Une URL déjà consultée ne peut empêcher toute copie.

## Documents contractuels

Le schéma attendu contient `document_id`, `version`, `title`, `effective_at`, `source` (`backend` ou `demo`) et `sections[{id,title,body}]`. Offre et commande référencent la version exacte. Les citations sont construites côté serveur. Absence, indisponibilité et interdiction sont distinctes. Aucun brouillon local n'est substitué en mode API.

## Invariants serveur

Permissions objet par objet, prix autoritaire, instantané immuable, quota atomique, idempotence persistante, unicité fournisseur/webhook, revalidation des droits, isolation comptes/éditeurs, DTO fermés, audit privilégié, fichiers privés et événements ordonnés. Les contrôles frontend ne prouvent aucun de ces invariants.

## Questions avant pilote

Topologie et cookies ; rotation CSRF ; récupération d'opération ; prestataire et modes ; origines stockage ; documents juridiques ; retrait ; taxes/territoires/devises ; rétention ; MFA administrateur ; paiement tardif après expiration.
