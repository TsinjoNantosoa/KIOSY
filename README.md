# Kiosy

Kiosy est livré sous forme d'un frontend React/Vite existant et d'un backend FastAPI/PostgreSQL ajouté dans `backend/`. Le backend est l'autorité pour les prix, quotas, paiements, droits, transitions et approbations.

## Démarrage local

Prérequis : Docker Desktop, Node 20+ et Python 3.12 si les services sont lancés hors conteneurs.

```powershell
Copy-Item backend/.env.example backend/.env
# Remplacer KIOSY_SECRET_KEY et KIOSY_STORAGE_SECRET_KEY dans backend/.env
docker compose up -d postgres qdrant minio minio-init mailpit
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\alembic upgrade head
$env:KIOSY_SEED_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
.venv\Scripts\python -m app.scripts.seed
.venv\Scripts\python -m app.scripts.setup_checkpointer
```

Dans deux terminaux `backend` :

```powershell
.venv\Scripts\uvicorn app.main:app --reload
.venv\Scripts\python -m app.workers.runner
```

Puis dans `frontend` :

```powershell
npm install
$env:VITE_APP_MODE="api"
$env:VITE_API_BASE_URL="http://localhost:8000"
npm run dev
```

La documentation API locale est sur `http://localhost:8000/docs`, Mailpit sur `http://localhost:8025`, et MinIO sur `http://localhost:9001`.

## Tests

```powershell
cd backend
$env:KIOSY_DATABASE_URL="postgresql+psycopg://kiosy:kiosy-local-only@localhost:5432/kiosy"
$env:KIOSY_SECRET_KEY="une-cle-de-test-de-plus-de-32-caracteres"
$env:KIOSY_LLM_PROVIDER="deterministic"
.venv\Scripts\pytest
.venv\Scripts\ruff check app migrations tests

cd ../frontend
npm run typecheck
npm test -- --run
npm run build
```

Le seed refuse les environnements staging/production et exige `KIOSY_SEED_PASSWORD`; aucun mot de passe privilégié n'est versionné.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Progression P0](docs/PROGRESS.md)
- [Matrice de couverture](docs/COVERAGE.md)
- [Contrats MCP](docs/MCP_CONTRACTS.md)
- [Multi-agent KIA](docs/MULTI_AGENT.md)
- [Rapport de tests](docs/TEST_REPORT.md)
- [Azure OpenAI](docs/AZURE.md)
- [Exploitation](docs/OPERATIONS.md)
- [Vérification et limites](docs/VERIFICATION.md)
