# OpenAI et KIA

Kiosy accepte OpenAI direct et Azure OpenAI. Le fournisseur de génération et celui des embeddings sont choisis séparément afin d’éviter de mélanger modèle de chat et espace vectoriel.

Configuration OpenAI directe :

```env
KIOSY_LLM_PROVIDER=openai
KIOSY_EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_CHAT_MODEL=gpt-6-astra
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
KIOSY_ENABLE_LIVE_OPENAI=true
KIOSY_EMBEDDING_NAMESPACE_VERSION=v2
```

La clé reste exclusivement dans `backend/.env` ou dans le gestionnaire de secrets de l’hébergeur. Elle ne doit jamais être placée dans une variable `VITE_*`, un log, un rapport de diagnostic ou Git.

La génération directe utilise Responses API. Les embeddings utilisent l’API Embeddings et Qdrant demeure le stockage vectoriel afin que Kiosy puisse appliquer ses droits d’accès métier. Après tout changement de modèle, de dimensions ou de namespace, exécuter une réindexation complète.

Le diagnostic validé doit vérifier séparément génération et embeddings sans afficher la clé. La santé opérationnelle de l’index se consulte ensuite via la commande ou l’endpoint documentés dans `RAG.md`.
