# Déploiement

## Local

Compose fournit PostgreSQL 16, Qdrant, S3Mock S3-compatible et Mailpit. Copier `backend/.env.example`, remplacer les secrets locaux, puis exécuter Alembic, le seed et `app.scripts.setup_checkpointer`. Les images MinIO historiques ayant été retirées des registres en 2026, le développement local utilise `adobe/s3mock:5.1.0` sans modifier l’API S3 du backend.

## Render

`render.yaml` crée l’API, le worker et PostgreSQL. L’API seule exécute `alembic upgrade head && python -m app.scripts.setup_checkpointer`. Le secret Kiosy et les réglages communs sont partagés ; les secrets stockage, Qdrant, SMTP et Azure sont saisis dans Render puis référencés par le worker. Ne jamais lancer les migrations depuis plusieurs workers.

## Vercel

Le répertoire racine est `frontend`. Définir `VITE_APP_MODE=api`, `VITE_API_BASE_URL=https://…` et `VITE_ASSET_ALLOWED_ORIGINS`. Ces variables sont publiques : aucune clé Azure, stockage, SMTP ou session ne doit commencer par `VITE_`. Reporter l’origine Vercel exacte dans `KIOSY_FRONTEND_ORIGINS` et `KIOSY_MCP_ALLOWED_ORIGINS`.

Le déploiement réel, les domaines, Azure live et les dépendances cloud sont `BLOCKED_EXTERNAL` tant que les comptes et secrets ne sont pas fournis.
