# Sécurité P0

- Session opaque hachée en PostgreSQL, cookies HttpOnly, rotation CSRF et CORS à origines exactes.
- Cookies de production obligatoirement `Secure` et `SameSite=None`; aucun token durable dans `localStorage`.
- RBAC API et isolation par propriétaire ; connaître un UUID ne donne aucun accès.
- Jetons MCP courts avec `iss`, `aud`, `sub`, scopes, `iat`, `exp`, `jti` et trace ; schémas d’arguments fermés.
- Prix, quotas, droits, paiements et transitions restent autoritaires côté services métier.
- Audit des mutations majeures ; secrets, tokens, cookies, mots de passe, cartes et URLs signées sont filtrés récursivement.
- Refus avant outil pour exfiltration, accès croisé, SQL/HTTP arbitraire, paiement sans confirmation et prompt injection explicite.
- Le validateur de configuration interdit en production localhost, HTTP pour les dépendances, Mailpit, cookies faibles et paiement de test.

Limites connues : aucun DRM absolu ; Azure live, SMTP, stockage cloud et CORS cross-site doivent être validés sur les environnements réels.
