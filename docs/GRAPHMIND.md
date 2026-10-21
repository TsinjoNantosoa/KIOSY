# GraphMind — intelligence de code locale

GraphMind est utilisé uniquement pendant le développement pour interroger le graphe du code KIOSY, mesurer l'impact d'un changement et conserver des décisions techniques durables. Il n'appartient pas au runtime KIA et n'est exposé à aucun utilisateur.

## Installation et initialisation

Version validée sous Windows : `graphmind 0.3.7`. Le binaire Windows x64 provient de la release officielle et son SHA-256 a été vérifié avant installation. Le runtime Microsoft Visual C++ v14 x64 est requis sur cette machine.

```powershell
graphmind --version
graphmind setup
Set-Location C:\chemin\vers\Kiosy
graphmind init
graphmind status
```

`graphmind init` est idempotent. Les données locales restent dans `%USERPROFILE%\.graphmind`; elles ne sont pas versionnées. Les hooks Git reconstruisent le graphe après les changements Git et affichent l'impact avant un push.

## Connexion à Codex

GraphMind est déclaré comme serveur MCP stdio avec un chemin absolu :

```powershell
codex mcp add graphmind -- "$env:USERPROFILE\.graphmind\bin\graphmind.exe" mcp
codex mcp list
codex mcp get graphmind
```

Validation initiale du 21 octobre 2026 : Codex a découvert `graphmind` et appelé réellement `graphmind/gm_status`. Après les changements finaux, `graphmind build` contient **1 090 symboles, 3 509 arêtes et 240 fichiers**.

## Workflow avant et après modification

Avant une modification non triviale : rechercher le symbole, lire son détail, ses dépendances, ses appelants, son blast radius et les mémoires pertinentes. Inspecter ensuite directement le code concerné.

Après la modification : examiner `git diff`, lancer `graphmind diff-impact`, reconstruire le graphe si nécessaire, contrôler les cycles et exécuter les tests ciblés puis de régression.

Commandes utiles :

```powershell
graphmind search "waiting_approval" --code-only
graphmind fn prepare_purchase
graphmind fn-impact prepare_purchase
graphmind deps backend/app/workers/runner.py
graphmind cycles
graphmind dead-code
graphmind diff-impact
```

## Constat initial KIOSY

- `waiting_approval` est relié à l'orchestration, au worker, aux propositions et à leurs tests de reprise.
- `prepare_purchase` traverse l'orchestrateur, le serveur MCP, les services catalogue/commerce, `Proposal` et les tests worker/MCP.
- `DurableTask` est consommé par le worker, l'enqueue commerce et la réindexation RAG administrative.
- Les tests principaux du worker sont dans `backend/tests/test_worker.py` et couvrent bail, heartbeat, fencing, retry, reprise et approbation.
- Le cycle `ai/orchestration.py` ↔ `mcp/invoke.py` mérite une surveillance, sans refactorisation aveugle.
- Les cycles impliquant des tests ou `frontend/src/mocks/db.ts` ↔ `seed.ts` sont à confirmer par inspection directe.
- Les nœuds LangGraph, méthodes de providers et outils décorés apparaissent comme dead code parce que leur usage est dynamique. Ils ne doivent pas être supprimés sur ce seul signal.

La revue finale signale huit cycles orientés, soit quatre paires principales : `admin_views.py` ↔ `assistant.py`, `orchestration.py` ↔ `mcp/invoke.py`, mocks `db.ts` ↔ `seed.ts`, et provider ↔ test Azure. L'inspection directe confirme des relations dynamiques/test connues ; aucun nouveau refactor risqué n'a été entrepris. `diff-impact` ne signale aucun fichier additionnel au-delà du diff actuel.

## Mémoire et sécurité

La mémoire projet contient uniquement des décisions, patterns, conventions et contextes durables. Avant un ajout, rechercher une entrée équivalente afin d'éviter les doublons. Les faits temporaires ou purement opérationnels ne doivent pas y être conservés.

Ne jamais mémoriser : secrets, clés API, mots de passe, tokens, cookies, URLs signées ou données utilisateur privées. Les embeddings locaux suffisent pour l'analyse GraphMind ; les secrets OpenAI/Azure de KIOSY ne doivent pas lui être transmis.

## Frontière de runtime

GraphMind ne doit jamais être appelé depuis `backend/app/ai/orchestration.py`, un spécialiste KIA, les MCP catalogue/commerce/assistance, l'API publique ou le worker de production. Le runtime public demeure KIA → LangGraph → MCP métier → services métier/PostgreSQL.
