# Contrats API P0

L’OpenAPI généré par FastAPI sur `/docs` est la source détaillée. Les familles stables sont :

- `/v1/auth/*` : CSRF, inscription, connexion, déconnexion, reset et sessions ;
- `/v1/publications`, `/v1/offers`, `/v1/contract-documents/*` : catalogue public ;
- `/v1/orders/*`, `/v1/me/orders`, `/v1/test-payments/*` : devis, commandes et paiement de test ;
- `/v1/me/library`, `/v1/assets/*/access`, `/v1/me/subscriptions` : droits privés ;
- `/v1/conversations/*`, `/v1/runs/*`, `/v1/proposals/*` : KIA, SSE, interruptions et approbations ;
- `/v1/support/*` et `/v1/admin/*` : support et administration RBAC.

Les mutations exigent CSRF et, lorsqu’elles peuvent être répétées, `Idempotency-Key`. Les erreurs utilisent `{code, message, details, request_id}`. Le client ne fournit jamais un prix autoritaire ni un identifiant utilisateur délégué.
