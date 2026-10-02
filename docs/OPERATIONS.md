# Guide d'exploitation

## Render et Vercel

`render.yaml` sépare API et worker; seule l'API lance `alembic upgrade head` en pré-déploiement. Les deux services doivent recevoir exactement le même `KIOSY_SECRET_KEY`, la même base, les accès S3/Qdrant/SMTP et les paramètres Azure. Configurer côté Vercel `VITE_APP_MODE=api` et `VITE_API_BASE_URL`, puis déclarer l'origine Vercel exacte dans `KIOSY_FRONTEND_ORIGINS`. En cross-site, utiliser HTTPS, `KIOSY_COOKIE_SECURE=true` et `KIOSY_COOKIE_SAMESITE=none`.

Qdrant et le stockage S3 sont des services persistants externes à fournir à Render; le blueprint ne crée volontairement aucun service payant. Le simulateur de paiement reste désactivé en production.

## Santé, tâches et arrêt

`/health/live` vérifie le processus; `/health/ready` vérifie PostgreSQL sans exposer de détail. Surveiller les `durable_tasks` en `running` dont `lease_until` est dépassé, et les statuts `failed`. Un worker interrompu laisse expirer son bail; un autre reprend la tâche. L'arrêt de l'API ne détruit aucun travail durable.

## Sauvegarde et restauration

Sauvegarder PostgreSQL avec `pg_dump --format=custom`, le bucket S3 avec le mécanisme versionné du fournisseur et Qdrant avec ses snapshots. Restaurer dans un environnement isolé, appliquer les migrations correspondant à la version applicative, restaurer Qdrant/S3, puis réaliser les contrôles de droits et de lecture avant bascule DNS. Tester cette procédure périodiquement.

## Rotation des secrets

Faire une rotation coordonnée API/worker. La rotation de `KIOSY_SECRET_KEY` invalide sessions et jetons MCP/CSRF existants; planifier une reconnexion. Faire chevaucher les clés S3/SMTP/Azure si le fournisseur le permet, redéployer, tester, puis révoquer l'ancienne. Ne jamais journaliser les valeurs.

## Rollback

Redéployer l'image précédente seulement si sa version de schéma est compatible. Les migrations destructives doivent être séparées en phases expand/migrate/contract. Restaurer une sauvegarde uniquement après arrêt des écritures et validation de la cible exacte.
