# Sécurité P0

- Session opaque hachée en PostgreSQL, cookies HttpOnly, rotation CSRF et CORS à origines exactes.
- Cookies de production obligatoirement `Secure` et `SameSite=None`; aucun token durable dans `localStorage`.
- RBAC API et isolation par propriétaire ; connaître un UUID ne donne aucun accès.
- Jetons MCP courts avec `iss`, `aud`, `sub`, scopes, `iat`, `exp`, `jti` et trace ; schémas d’arguments fermés.
- Prix, quotas, droits, paiements et transitions restent autoritaires côté services métier.
- Audit des mutations majeures ; secrets, tokens, cookies, mots de passe, cartes et URLs signées sont filtrés récursivement.
- Refus avant outil pour exfiltration, accès croisé, SQL/HTTP arbitraire, paiement sans confirmation et prompt injection explicite.
- Le validateur de configuration interdit en production localhost, HTTP pour les dépendances, Mailpit, cookies faibles et paiement de test.
- Les assets d'une édition non publiée sont refusés même si un droit historique existe ; chaque accès S3 est revalidé avant signature.
- Le frontend n'accepte les redirections externes qu'en HTTPS, avec une exception HTTP strictement limitée à `localhost`/loopback pour le prestataire de test.
- GraphMind est un outil local de développement : aucun import, endpoint ou secret GraphMind n'existe dans le runtime KIA.

Limites connues : aucun DRM absolu ; Azure live, SMTP, stockage cloud et CORS cross-site doivent être validés sur les environnements réels.
