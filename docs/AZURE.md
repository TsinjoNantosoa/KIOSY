# Azure OpenAI

Kiosy utilise exclusivement l'API Azure OpenAI v1 via le client `OpenAI` et une base URL `https://<ressource>.openai.azure.com/openai/v1/`. Le nom du déploiement Azure est passé dans `model`; le déploiement d'embeddings est distinct.

Variables privées : `KIOSY_LLM_PROVIDER=azure`, `KIOSY_ENABLE_LIVE_AZURE=true`, `KIOSY_AZURE_OPENAI_API_KEY`, `KIOSY_AZURE_OPENAI_ENDPOINT`, `KIOSY_AZURE_OPENAI_DEPLOYMENT` et `KIOSY_AZURE_OPENAI_EMBEDDING_DEPLOYMENT`.

Diagnostic borné, jamais exécuté implicitement :

```powershell
cd backend
.venv\Scripts\python scripts/diagnose_azure.py
```

Il vérifie un court appel texte, un appel d'outil forcé et un embedding, puis imprime uniquement les noms de déploiement, durées, dimensions et erreurs tronquées. Il n'imprime pas la clé. Sans activation explicite, il termine avec `LIVE_AZURE_DISABLED`. Le fournisseur `deterministic` est réservé aux tests; `disabled` conserve les fonctions classiques et renvoie une indisponibilité explicite pour l'IA.
