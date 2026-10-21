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

## OpenAI et Azure OpenAI

La génération et les embeddings sont configurables séparément avec `LLM_PROVIDER` et `EMBEDDING_PROVIDER` (`openai`, `azure` ou `deterministic` hors production). OpenAI Responses utilise `OPENAI_API_KEY`; Azure utilise les variables `AZURE_OPENAI_*`. Les appels live exigent leur drapeau explicite `KIOSY_ENABLE_LIVE_OPENAI` ou `KIOSY_ENABLE_LIVE_AZURE`. Le diagnostic Azure est strictement opt-in :

```powershell
$env:RUN_AZURE_LIVE_TESTS="true"
.venv\Scripts\python -m app.scripts.diagnose_azure
```

Ne jamais versionner une clé. Sans deployment embeddings Azure, le chat Azure reste utilisable mais le RAG doit utiliser OpenAI embeddings ou rester bloqué explicitement.

## GitHub Actions

La CI couvre PostgreSQL, Qdrant, S3Mock, Alembic, checkpointer, seed, Ruff, Pytest, MyPy informatif, `npm ci`, typecheck, lint, Vitest, deux builds, Playwright démo et un E2E API avec API + worker réels. Le job `azure-live` ne s'exécute que si la variable GitHub `RUN_AZURE_LIVE_TESTS=true`; sa clé provient exclusivement des secrets GitHub.

## Render

`render.yaml` prépare l'API, le worker, PostgreSQL, `/health/ready`, Alembic et le checkpointer. Une seule commande de pré-déploiement applique les migrations ; le worker ne migre jamais la base. Les secrets stockage, Qdrant, SMTP et OpenAI sont partagés avec le worker. Aucun service payant n'a été créé.

## Vercel

Le répertoire racine est `frontend`. Définir `VITE_APP_MODE=api`, `VITE_API_BASE_URL` et `VITE_ASSET_ALLOWED_ORIGINS`. Reporter l'origine Vercel exacte dans `KIOSY_FRONTEND_ORIGINS` et `KIOSY_MCP_ALLOWED_ORIGINS`. Aucune clé OpenAI/Azure, stockage, SMTP ou session ne doit être exposée via une variable `VITE_*`.

Le déploiement réel et les validations staging restent `BLOCKED_EXTERNAL`.
