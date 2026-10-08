# Rapport de tests — vérité principale

Dernière exécution complète : **7 octobre 2026**, Windows 11, Python 3.12.10, Node 24.13, PostgreSQL 16 et Qdrant locaux.

| Commande | Résultat | Passed | Failed | Skipped | Notes |
|---|---|---:|---:|---:|---|
| `python -m ruff check app tests migrations` | PASS | — | 0 | 0 | backend |
| `python -m compileall -q app tests migrations` | PASS | — | 0 | 0 | backend |
| `pytest -q` avec PostgreSQL réel | PASS | 29 | 0 | 0 | inclut concurrence 100, MCP HTTP, worker, RAG, T02/T11/T12 et benchmark |
| `python -m app.scripts.evaluate_ai` | PASS | 80 | 0 | 0 | 323 outils, 117 appels déterministes, coût estimé 0 |
| Alembic `upgrade/check/downgrade/upgrade/check` base vierge | PASS | 5 étapes | 0 | 0 | aucune dérive |
| `pg_dump` + `pg_restore` isolé | PASS | 35 tables | 0 | 0 | 2 130 utilisateurs identiques source/restauration |
| `npm run typecheck` | PASS | — | 0 | 0 | frontend |
| `npm run lint` | PASS | — | 0 | 0 | 12 avertissements Fast Refresh, 0 erreur |
| `npm test -- --run` | PASS | 48 | 0 | 0 | 11 fichiers |
| builds Vite `demo` et `api` | PASS | 2 | 0 | 0 | URL API locale de test |
| `npx playwright test --workers=2` | PASS | 22 | 0 | 0 | 20 desktop, 2 mobile Chromium |
| `python -m mypy app` | BLOCKED_ENVIRONMENT | 0 | 0 | 1 | politique Windows bloque une DLL ; contrôle présent en CI Linux |
| GitHub Actions | BLOCKED_EXTERNAL | 0 | 0 | 1 | workflow ajouté, pas encore poussé/exécuté |
| Azure OpenAI live | BLOCKED_EXTERNAL | 0 | 0 | 1 | aucun secret fourni, aucun score fabriqué |
| Render/Vercel | BLOCKED_EXTERNAL | 0 | 0 | 1 | manifestes validés statiquement, aucun déploiement revendiqué |

Historique utile : la baseline Vitest était 47/48 à cause d’une vraie course de double clic checkout ; après correction, 48/48. Un premier Playwright à 6 workers avait fini 21/22 sur timeout local ; le test isolé puis la suite complète à 2 workers passent. Les rapports frontend détaillent les scénarios UI, mais ce fichier est la source courante des totaux.
