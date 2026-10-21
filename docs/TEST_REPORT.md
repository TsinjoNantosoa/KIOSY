# Rapport de tests — vérité principale

Dernière passe : **21 octobre 2026**, Windows 11, Python 3.12, Node 22, PostgreSQL 16, Qdrant et S3Mock locaux.

| Contrôle | Résultat | Détail |
|---|---|---|
| Ruff backend | PASS | `app`, `tests`, `migrations` |
| Alembic | PASS | schéma à `head`, aucune opération nouvelle détectée |
| Pytest complet PostgreSQL | PASS | **49 passed**, 0 failed |
| Vitest | PASS | **52 passed** dans 14 fichiers |
| TypeScript | PASS | `tsc -b --noEmit` |
| ESLint | PASS | 0 erreur, 12 avertissements Fast Refresh historiques |
| Builds Vite | PASS | modes `demo` et `api` |
| Playwright démo | PASS | **22 passed** desktop/mobile |
| Playwright API réel | PASS | **3 passed** avec API, worker durable, SSE, PostgreSQL et paiement de test |
| Docker Compose | PASS | `docker compose config --quiet` |
| YAML/JSON déploiement | PASS | CI, Render et Vercel parsables |
| Azure OpenAI live | PASS partiel | chat, outils, structured output, timeout et erreur de déploiement validés |
| OpenAI live | PASS | classification, génération et embeddings (1536 dimensions) |
| Réindexation RAG | PASS | 56 passages : 26 catalogue, 6 contrats, 24 contenus d'édition |
| MyPy strict | DETTE | 168 erreurs préexistantes dans 21 fichiers ; contrôle CI visible mais non bloquant |
| `npm audit` | DETTE | 11 alertes d'outillage : 3 modérées, 6 hautes, 2 critiques |
| GitHub Actions distant | BLOCKED_EXTERNAL | `gh` absent et aucune exécution distante autorisée |
| Render/Vercel staging | BLOCKED_EXTERNAL | configuration validée, aucun compte/déploiement fourni |

## E2E API réel

Le fichier `frontend/e2e-api/kia-api.spec.ts` valide :

1. recommandation business, contrôle des droits, comparaison, citations, « Je veux souscrire », approbation, paiement, retour et accès ;
2. diagnostic d'accès avec apostrophe typographique, handoff puis création d'un ticket ;
3. achat d'un abonnement, paiement, demande de résiliation, proposition et exécution uniquement après confirmation.

## Sécurité et stockage

Les tests couvrent les droits S3 privés, URL signée et renouvelée, second utilisateur refusé, droit révoqué refusé et édition suspendue refusée. Les tests SSE couvrent ordre, heartbeat, reprise `after_seq`/`Last-Event-ID`, déconnexion TCP, attente utilisateur/approbation et terminaux `completed`, `failed`, `cancelled`.

## Dettes non masquées

MyPy strict et `npm audit` restent ouverts. Les corrections npm automatiques proposées imposent des migrations majeures (Vitest 5 et Tailwind 4) et ne sont donc pas appliquées avec `--force` dans cette phase.
