# RAG et citations

Les imports autorisés sont découpés par édition et indexés dans Qdrant. PostgreSQL conserve le texte, la version, la visibilité, le propriétaire, le droit IA et l’état de retrait. Chaque hit Qdrant est revalidé dans PostgreSQL contre les entitlements actuels avant d’être cité.

L’espace d’embeddings vaut `<namespace-version>:<provider>:<embedding-deployment>`. Le déploiement d’embeddings Azure est distinct du déploiement de génération ; un changement crée une autre collection et empêche de mélanger des vecteurs incompatibles.

Un retrait marque immédiatement les passages comme retirés et les rend inéligibles même si un vecteur résiduel existe encore. Les citations exposent document, version, section, extrait borné et lien interne. En absence de preuve, KIA signale le manque au lieu d’inventer.
