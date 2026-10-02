# Architecture et décisions

## ADR-001 — Monolithe modulaire

L'API, les services métier, l'orchestration et les trois serveurs MCP partagent un déploiement et une base de code. Le worker est un processus séparé. Cette organisation garde une seule définition des règles métier tout en permettant de dimensionner API et worker séparément.

## ADR-002 — PostgreSQL comme journal autoritaire

PostgreSQL conserve états métier, opérations idempotentes, outbox, tâches, baux, checkpoints de runs et événements SSE. Aucun Redis n'est requis au MVP : il éviterait peu de charge tout en ajoutant un second état durable à exploiter. Les claims utilisent `FOR UPDATE SKIP LOCKED` et des baux récupérables.

## ADR-003 — Paiement de test isolé

`kiosy-test` est un connecteur backend explicitement marqué `mode=test`. Il est désactivé sur Render par défaut. Le retour navigateur n'active aucun droit; seul le traitement d'un événement prestataire le fait. Un connecteur commercial devra implémenter authentification de webhook, interrogation autoritaire et réconciliation sans modifier le domaine commerce.

## ADR-004 — Session et CSRF

Une session opaque hachée est conservée en base et transportée par cookie HttpOnly. Un second cookie HttpOnly lie un jeton CSRF signé, court et retourné par `/v1/auth/csrf`. Les origines CORS sont exactes, les credentials activés et le jeton est invalidé lors d'un changement de session.

## ADR-005 — MCP v2 et contexte délégué

Trois applications Streamable HTTP (`catalog`, `commerce`, `assistance`) exposent de vrais outils MCP. Leur contexte est un jeton signé à audience, scopes, sujet et expiration courts; aucun identifiant utilisateur libre issu du modèle n'est accepté.

## ADR-006 — RAG cloisonné

Qdrant ne contient que des vecteurs et métadonnées de filtrage. PostgreSQL conserve la preuve du passage et l'autorisation IA. Chaque résultat vectoriel est revalidé contre PostgreSQL et les droits actuels. Une collection distincte est créée par espace d'embeddings.
