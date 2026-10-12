# Rapport de vérification et limites

## Vérifié offline et localement — 12 octobre 2026

- PostgreSQL 16, migrations Alembic et checkpointer LangGraph ;
- backend : compilation, Ruff et 35 tests distincts sans échec observé ;
- MCP Streamable HTTP réel sur TCP, worker durable, RAG offline, propositions et approbations ;
- SSE : ordre, reprise par séquence, heartbeat, statuts d'attente, session expirée et 403 ;
- S3Mock : upload/lecture privés, URL signée, renouvellement et révocation du droit ;
- frontend : `npm ci`, typecheck, lint, 48 Vitest, builds démo/API et 22 Playwright ;
- YAML GitHub Actions/Render/Compose et `docker compose config`.

## Azure OpenAI live

Le fichier local est préparé avec l'endpoint brut, le déploiement `gpt-35-turbo` et l'API `2025-01-01-preview`. Le diagnostic opt-in s'est arrêté explicitement avec `AI_NOT_CONFIGURED`, avant tout appel externe. Une clé réelle apparue ensuite dans le working tree de `.env.example` a été retirée immédiatement et doit être considérée comme compromise ; elle n'a pas été utilisée. Aucun appel chat, tool calling, structured output, scénario KIA live ou test d'erreur Azure n'est donc revendiqué.

Le déploiement embeddings n'a pas été fourni. Le RAG Azure live reste `BLOCKED_EXTERNAL`; seuls les tests embeddings déterministes/offline sont validés.

## Limites ouvertes

- S3Mock ne rejette pas physiquement une URL déjà signée après son expiration ; validation à refaire sur le stockage managé choisi ;
- le test de coupure/reconnexion SSE sur TCP est ajouté mais son exécution locale est bloquée par la politique Windows sur `grpc/cygrpc`; le build de repli Linux a expiré après 304 secondes ;
- MyPy remonte 163 erreurs historiques dans 21 fichiers ; cette dette n'est pas un gate P0 mais reste ouverte ;
- `npm audit` conserve 10 alertes dans l'outillage, dont les correctifs proposés imposent Vitest 5 et Tailwind 4 ;
- aucun paiement commercial, SMTP réel, stockage/Qdrant managés ou déploiement staging ;
- aucune exécution GitHub Actions, Render ou Vercel ;
- aucun E2E navigateur contre une API publiquement déployée.
- rotation de la clé Azure exposée puis fourniture de la nouvelle clé uniquement dans `backend/.env` ou un secret GitHub/Render.

L'OCR, l'antivirus de fichiers, Mobile Money, remboursements et rate limiting distribué restent hors du P0 livré.
