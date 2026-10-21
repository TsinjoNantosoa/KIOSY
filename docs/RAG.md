# RAG et citations

Les imports autorisés sont normalisés puis découpés par section et paragraphe, avec recouvrement configurable, avant indexation dans Qdrant. PostgreSQL conserve le texte, le type de source, la publication, l’édition, la version, la visibilité, les métadonnées, le droit IA et l’état de retrait. Les droits sont filtrés dans Qdrant puis systématiquement revalidés dans PostgreSQL avant citation.

L’espace d’embeddings vaut `<namespace-version>:<provider>:<embedding-model>:<dimensions>`. Trois collections distinctes sont dérivées de cet espace : catalogue public, contenu d’édition et contrats. OpenAI et Azure disposent de réglages de génération et d’embeddings séparés. Un changement de modèle ou de dimensions crée de nouvelles collections.

La recherche combine similarité vectorielle et correspondance lexicale par fusion de rangs réciproques. Les seuils, poids, limites de candidats et taille du contexte sont configurables. Deux passages au maximum sont retenus par document pour préserver la diversité.

Un retrait marque immédiatement les passages comme retirés et les rend inéligibles même si un vecteur résiduel existe encore. Les citations exposent document, version, date d’effet, section, extrait borné et lien interne. En absence de preuve, KIA signale le manque au lieu d’inventer.

Commandes d’exploitation :

```powershell
python -m app.scripts.reindex_rag
python -m app.scripts.reindex_rag --health
```

Les administrateurs disposent aussi de `GET /v1/admin/rag/health` et `POST /v1/admin/rag/reindex`.

Un corpus JSONL contenant des identifiants réels peut mesurer Recall@K, MRR, latence et fuite ACL :

```powershell
python -m app.scripts.evaluate_rag data/rag_eval_live.jsonl --limit 5
```
