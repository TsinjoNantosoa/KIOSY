# Rapport de tests — vérité principale

Dernière passe : **12 octobre 2026**, Windows 11, Python 3.12, Node, PostgreSQL 16, Qdrant et S3Mock locaux.

| Commande | Résultat | Passed | Failed | Skipped | Notes |
|---|---|---:|---:|---:|---|
| `python -m compileall -q app tests migrations` | PASS | — | 0 | 0 | backend |
| `python -m ruff check app tests migrations` | PASS | — | 0 | 0 | backend |
| `pytest -q` avec PostgreSQL réel | PASS | 34 | 0 | 0 | suite complète avant ajout du test unitaire Azure |
| `pytest tests/test_azure_provider.py -q` | PASS | 1 | 0 | 0 | adaptateur Azure mocké, sans appel externe |
| tests ciblés S3/SSE/configuration | PASS | 7 | 0 | 0 | inclus dans les 34 tests complets ; reprise logique SSE incluse |
| coupure/reconnexion SSE sur TCP Uvicorn | BLOCKED_ENVIRONMENT | 0 | 0 | 1 | test ajouté et linté ; `grpc/cygrpc` bloqué par Windows, build Linux expiré après 304 s |
| `python -m app.scripts.evaluate_ai` | PASS historique | 80 | 0 | 0 | exécution offline du 7 octobre, non relancée dans cette passe |
| `python -m mypy app` | FAIL | 0 | 163 erreurs | 0 | dette de typage réelle dans 21 fichiers ; retiré du gate CI P0, non masqué |
| `npm ci` | PASS | 373 paquets | 0 | 0 | installation propre |
| `npm run typecheck` | PASS | — | 0 | 0 | frontend |
| `npm run lint` | PASS | — | 0 | 0 | 0 erreur, 12 avertissements Fast Refresh |
| `npm test -- --run` | PASS | 48 | 0 | 0 | 11 fichiers |
| builds Vite `demo` et `api` | PASS | 2 | 0 | 0 | builds distincts |
| `npx playwright test --workers=2` | PASS | 22 | 0 | 0 | 20 desktop, 2 mobile, 3,4 min |
| `npm audit fix` sans `--force` | PARTIAL | 1 alerte corrigée | 10 restantes | 0 | 3 modérées, 5 hautes, 2 critiques dans l'outillage ; corrections restantes majeures |
| diagnostic Azure opt-in | BLOCKED_EXTERNAL | 0 | 1 blocage config | 0 | exit 2 : clé absente au moment du diagnostic ; toute clé exposée doit être révoquée |
| GitHub Actions | BLOCKED_EXTERNAL | 0 | 0 | 1 | YAML validé localement, workflow non exécuté sur GitHub |
| Render/Vercel | BLOCKED_EXTERNAL | 0 | 0 | 1 | configuration statique validée, aucun déploiement revendiqué |

Le total backend passé est **35 tests distincts** : 34 exécutés ensemble, puis le nouveau test unitaire Azure exécuté séparément. Un 36e test de coupure SSE TCP est présent mais reste à exécuter en CI Linux. Aucun résultat Azure live n'est inventé.

Contrôle secrets : une valeur Azure réelle est apparue transitoirement dans le working tree de `.env.example` pendant la passe. Elle a été supprimée immédiatement ; `HEAD` ne la contenait pas, aucun fichier `.env` privé n'est suivi et le scan final ne trouve plus d'affectation secrète. La valeur exposée doit être révoquée avant tout test live.

## S3 local

Le test utilise réellement `adobe/s3mock:5.1.0` sur le port 9090 : upload, lecture, contrôle du droit, génération d'URL signée, échéance courte constatée, nouvelle URL puis révocation et refus 403. S3Mock sert encore une URL déjà signée après son échéance et ne permet donc pas de prouver l'application cryptographique de l'expiration par un fournisseur managé.

## SSE

Les tests backend passés couvrent connexion, ordre, `after_seq`, `Last-Event-ID`, heartbeat, statuts `waiting_user`, `waiting_approval`, `completed`, reprise logique, session expirée et refus 403. Le test TCP ajouté vérifie qu'une fermeture réelle ne transforme pas le run en échec, mais son exécution locale est `BLOCKED_ENVIRONMENT`.
