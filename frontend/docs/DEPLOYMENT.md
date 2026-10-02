# Déploiement (Vercel)

Rien n'est publié automatiquement et aucun service payant n'est créé par ce dépôt.

## Réglages Vercel

| Réglage | Valeur |
|---|---|
| Répertoire racine | `frontend` |
| Framework | Vite (détecté) |
| Commande de build | `npm run build` |
| Dossier de sortie | `dist` |
| Node | 20 ou supérieur |

[`vercel.json`](../vercel.json) fournit la réécriture SPA (toute URL interne renvoie `index.html`, sauf `assets/`, `favicon.svg`, `robots.txt`), des en-têtes de sécurité de base (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`) et un cache long pour `/assets/*`. L'ouverture directe d'une URL interne (ex. `/conditions/vente#resiliation`) est couverte par un test E2E sur le build servi par `vite preview` (équivalent fonctionnel ; à revérifier sur le déploiement réel).

## Variables d'environnement (publiques)

| Variable | Production/staging | Démo publique |
|---|---|---|
| `VITE_APP_MODE` | `api` | `demo` |
| `VITE_API_BASE_URL` | `https://api.<domaine>` (HTTPS obligatoire ; vérifié au démarrage) | — |
| `VITE_ASSET_ALLOWED_ORIGINS` | origines HTTPS du stockage, séparées par des virgules | vide (`blob:` local) |
| `VITE_DEMO_LATENCY_MS` | — | optionnel |

Aucun secret dans ces variables. **Ne jamais** déployer la production commerciale en mode `demo`.

## Session, cookies, CORS (à traiter côté serveur)

Le frontend appelle l'API avec `credentials: "include"`. Il obtient un jeton par `GET /v1/auth/csrf`, le garde en mémoire et l'envoie dans `X-CSRF-Token`. Il ne lit aucun cookie du domaine API.

- Privilégier `app.<domaine>` et `api.<domaine>` (même site) : cookies `HttpOnly; Secure; SameSite=Lax`.
- Avec les domaines par défaut Vercel/Render (sites différents), les cookies sont « tiers » : `SameSite=None; Secure` requis et peuvent être bloqués par certains navigateurs. À éviter pour un pilote.
- CORS : `Access-Control-Allow-Origin` = origine exacte du frontend (pas `*`), `Access-Control-Allow-Credentials: true`, en-têtes autorisés `Content-Type, Idempotency-Key, X-CSRF-Token`, exposer `X-Request-ID`. CORS n'est **pas** une authentification.
- Le cookie de session reste HttpOnly. L'API doit permettre l'obtention du jeton CSRF en JSON sans exposer la session et vérifier jeton + cookie selon la stratégie retenue.
- SSE : `GET /v1/runs/{id}/events` avec `withCredentials` ; le frontend bascule en relecture périodique si le flux est coupé.

## Liste de contrôle

1. Variables définies, build vert (`npm run build`, `npm test`, `npm run lint`).
2. Staging : `npm run test:e2e` avec l'URL de staging en mode `api` (les E2E actuels ciblent le mode démo).
3. Vérifier le build `api` : aucun bandeau de démonstration, erreur claire si l'API est indisponible.
4. Domaines et certificats HTTPS avant toute exposition publique.
