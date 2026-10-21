# Rapport de vérification et limites

## Vérifié le 21 octobre 2026

- PostgreSQL 16, migrations Alembic et tables du checkpointer LangGraph ;
- 49 tests backend PostgreSQL, Ruff et absence de dérive de migration ;
- 52 tests frontend, typecheck, lint, builds démo/API ;
- 22 E2E démo et 3 E2E avec le véritable backend/worker ;
- MCP métier, tâches durables, SSE, propositions, paiements de test et idempotence ;
- S3 privé et refus après révocation/suspension éditoriale ;
- RAG hybride réindexé, métriques DB/Qdrant cohérentes et ACL revalidées ;
- Azure OpenAI live pour la génération et OpenAI live pour génération + embeddings ;
- GraphMind 0.3.7 installé, indexé, relié à Codex et utilisé pour les impacts.

## Limites ouvertes

- Azure embeddings : `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` absent, donc `BLOCKED_EXTERNAL` ;
- MyPy strict : 168 erreurs historiques ; le job CI est informatif jusqu'à résorption du baseline ;
- dépendances frontend : 11 avis npm dans l'outillage, migrations majeures requises ;
- S3Mock ne remplace pas la validation d'expiration cryptographique chez le fournisseur S3 managé ;
- aucun SMTP, Qdrant/S3 managé, paiement commercial ni staging Render/Vercel fourni ;
- workflow GitHub ajouté mais non observé sur GitHub depuis cette machine (`gh` absent).

L'OCR, l'antivirus, Mobile Money, les remboursements et le rate limiting distribué restent hors P0.
