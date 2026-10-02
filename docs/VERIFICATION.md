# Rapport de vérification et limites

## Vérifié localement

- migration Alembic sur PostgreSQL 16 et seed reproductible ;
- import de l'application et 88 routes après raccordement admin ;
- huit tests backend : flux API/auth/idempotence, devis expiré et prix client refusé, paiement tardif/dupliqué, 100 commandes concurrentes pour une place, échanges MCP officiels, bail worker abandonné, coopération multi-agent et RAG avec ACL/retrait ;
- lint Ruff, compilation Python et cohérence des dépendances ;
- 48 tests frontend, typecheck et build Vite après raccordement des documents, de l'inscription et des devis.

Les commandes et dates exactes de la dernière exécution sont consignées dans le compte rendu de livraison, pas inventées dans ce document.

## Non validé en environnement externe

- aucun appel Azure live : aucune clé privée active n'était disponible/activée ;
- aucun paiement commercial : seul `kiosy-test` existe et Render le désactive ;
- aucun déploiement Render/Vercel ni achat de service ;
- le SMTP réel, S3 managé et Qdrant managé demandent leurs secrets et un test d'intégration (le chemin Qdrant local en mémoire est testé) ;
- l'OCR n'est pas livré : un PDF scanné reçoit `OCR_REQUIRED` et n'est pas faussement indexé ;
- la protection anti-copie absolue est impossible après téléchargement d'un contenu autorisé ;
- le rate limiting distribué, antivirus de fichier, facturation automatique, remboursements et Mobile Money sont des extensions P1/P2, pas des fonctions déclarées opérationnelles.

Avant pilote commercial : compléter un test E2E navigateur contre l'environnement déployé, un test Qdrant/S3, les cas de paiement tardif et webhook signés du prestataire choisi, un test de restauration, une revue sécurité/observabilité et une évaluation Azure live bornée.
