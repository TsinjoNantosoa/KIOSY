# Déploiement

## Local

Compose fournit PostgreSQL 16, Qdrant, `adobe/s3mock:5.1.0` et Mailpit. Le S3Mock local écoute sur `http://127.0.0.1:9090`; `backend/.env` et `frontend/.env` doivent utiliser ce même port.

Après démarrage des services :

```powershell
cd backend
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m app.scripts.setup_checkpointer
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Lancer séparément le worker puis Vite. Les deux fichiers `.env` locaux sont ignorés par Git.

## Azure OpenAI

Les noms documentés `LLM_PROVIDER` et `AZURE_OPENAI_*` sont acceptés, ainsi que les variantes historiques préfixées `KIOSY_`. Les appels live exigent aussi `KIOSY_ENABLE_LIVE_AZURE=true`. Le diagnostic est strictement opt-in :

```powershell
$env:RUN_AZURE_LIVE_TESTS="true"
.venv\Scripts\python -m app.scripts.diagnose_azure
```

Ne jamais versionner la clé. Sans deployment embeddings, le chat peut être diagnostiqué mais le RAG Azure live ne peut pas être validé.

## GitHub Actions

La CI couvre PostgreSQL, Qdrant, S3Mock, Alembic, checkpointer, seed, Ruff, Pytest, `npm ci`, typecheck, lint, Vitest, deux builds et Playwright. Le job `azure-live` ne s'exécute que si la variable GitHub `RUN_AZURE_LIVE_TESTS=true`; sa clé provient exclusivement des secrets GitHub.

## Render

`render.yaml` prépare l'API, le worker, PostgreSQL, le health check `/health/ready`, Alembic et le checkpointer. Les secrets stockage, Qdrant, SMTP et Azure sont saisis dans Render et partagés avec le worker. Aucun service payant n'a été créé.

## Vercel

Le répertoire racine est `frontend`. Définir `VITE_APP_MODE=api`, `VITE_API_BASE_URL` et `VITE_ASSET_ALLOWED_ORIGINS`. Reporter l'origine Vercel exacte dans `KIOSY_FRONTEND_ORIGINS` et `KIOSY_MCP_ALLOWED_ORIGINS`. Aucune clé Azure, stockage, SMTP ou session ne doit être exposée via une variable `VITE_*`.

Le déploiement réel et les validations staging restent `BLOCKED_EXTERNAL`.
