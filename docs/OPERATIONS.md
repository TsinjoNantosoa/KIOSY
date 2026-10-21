# Guide d'exploitation

## Render et Vercel

`render.yaml` sépare API et worker; seule l'API lance `alembic upgrade head` puis `python -m app.scripts.setup_checkpointer` en pré-déploiement. Les deux services partagent exactement le même secret Kiosy, la même base, les accès S3/Qdrant/SMTP et les paramètres Azure. Configurer côté Vercel `VITE_APP_MODE=api` et `VITE_API_BASE_URL`, puis déclarer l'origine Vercel exacte dans `KIOSY_FRONTEND_ORIGINS`. En cross-site, utiliser HTTPS, `KIOSY_COOKIE_SECURE=true` et `KIOSY_COOKIE_SAMESITE=none`.

Qdrant et le stockage S3 sont des services persistants externes à fournir à Render; le blueprint ne crée volontairement aucun service payant. Le simulateur de paiement reste désactivé en production.

Après un changement de fournisseur/modèle d'embeddings ou de version de namespace, exécuter `python -m app.scripts.reindex_rag`, puis contrôler `/v1/admin/rag/health`. Ne jamais mélanger des vecteurs de dimensions ou modèles différents dans une même collection logique.

## Santé, tâches et arrêt

`/health/live` vérifie le processus; `/health/ready` vérifie PostgreSQL sans exposer de détail. Surveiller les tâches au bail dépassé, les retries, les statuts `failed` et les outbox non publiées. Le worker renouvelle son bail, refuse les écritures d’un propriétaire obsolète et termine la tâche active avant l’arrêt gracieux lorsque le délai plateforme le permet.

Surveiller aussi les divergences de comptage DB/Qdrant, les passages retirés, les erreurs fournisseur LLM, le nombre de tool calls, les budgets et les feedbacks KIA. Une réponse RAG ne doit jamais contourner la revalidation ACL en base.

## Sauvegarde et restauration

Sauvegarder PostgreSQL avec `pg_dump --format=custom`, le bucket S3 avec le mécanisme versionné du fournisseur et Qdrant avec ses snapshots. Restaurer dans un environnement isolé, appliquer les migrations correspondant à la version applicative, restaurer Qdrant/S3, puis réaliser les contrôles de droits et de lecture avant bascule DNS. Tester cette procédure périodiquement.

## Rotation des secrets

Faire une rotation coordonnée API/worker. La rotation de `KIOSY_SECRET_KEY` invalide sessions et jetons MCP/CSRF existants; planifier une reconnexion. Faire chevaucher les clés S3/SMTP/Azure si le fournisseur le permet, redéployer, tester, puis révoquer l'ancienne. Ne jamais journaliser les valeurs.

## Rollback

Redéployer l'image précédente seulement si sa version de schéma est compatible. Les migrations destructives doivent être séparées en phases expand/migrate/contract. Restaurer une sauvegarde uniquement après arrêt des écritures et validation de la cible exacte.
