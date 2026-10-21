# Instructions de travail — KIOSY

Le code actuel et les tests sont la source de vérité. Vérifier un problème avant de le corriger et ne pas reconstruire le frontend, le backend ou l'architecture IA lorsqu'ils existent déjà.

## GraphMind policy — KIOSY

Pour toute modification non triviale :

1. utiliser GraphMind pour localiser les symboles pertinents ;
2. vérifier leurs dépendances et leur blast radius ;
3. consulter les décisions et mémoires liées ;
4. inspecter directement le code actuel ;
5. modifier uniquement les fichiers nécessaires ;
6. exécuter les tests ciblés ;
7. examiner le diff et, si disponible, `graphmind diff-impact` ;
8. exécuter les tests de régression appropriés ;
9. mettre à jour la mémoire GraphMind uniquement lorsqu'une décision d'architecture durable change.

GraphMind complète, mais ne remplace jamais, la lecture directe du code, `git diff`, les tests, l'analyse de sécurité, les migrations ni la revue des contrats API/MCP.

Toujours effectuer également une inspection directe pour l'authentification, l'autorisation, le paiement, les entitlements, les migrations DB, les propositions/approbations, MCP, les ACL RAG et le stockage privé.

GraphMind est un outil de développement local uniquement. Il ne doit jamais être importé, invoqué ou exposé par le runtime public KIA, les spécialistes LangGraph ou les serveurs MCP métier.

Ne jamais enregistrer dans GraphMind des secrets, clés API, mots de passe, jetons, cookies, URLs signées ou données privées d'utilisateurs.

