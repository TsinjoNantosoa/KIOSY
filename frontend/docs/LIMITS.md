# Ce qui est simulé, ce qui dépend du backend, limites

## Simulé en mode démonstration (signalé dans l'interface)

- Données (16 publications, 2 éditeurs, 26 offres dont 1 contingentée et 1 indisponible, 5 personas, commandes, tickets) : fictives, à la charge de [`src/mocks/`](../src/mocks).
- **Paiement** : page « TestPay » simulée ; les résultats (succès, retard, refus, annulation, absence de réponse) sont choisis à la main. Aucune carte, aucun secret.
- **Assistant KIA** : scénarios scriptés déterministes (mots-clés). Aucun LLM, aucun serveur MCP, aucun agent LangGraph. Les « spécialistes » du diagnostic décrivent un scénario joué ; tokens et coûts sont « non mesurés ».
- **Règles « serveur »** (quota, idempotence, transitions, séparation demandeur/approbateur, expiration) : reproduites en mémoire pour la démonstration. Elles ne prouvent rien sur un backend réel.
- PDF générés dans le navigateur après contrôle d'accès simulé ; URL `blob:` éphémères.
- Textes contractuels : **brouillons** non validés juridiquement.

## Nécessite le backend

Authentification et sessions, catalogue réel, prix/quota atomique (CON01–CON03), paiement et notifications vérifiées (PAY04–PAY06), réconciliation, entitlements, fichiers signés, import/ingestion, RAG, agents et MCP, audit, RLS, sauvegardes. Voir [API_CONTRACTS.md](API_CONTRACTS.md). Les tests de quota à 100 requêtes concurrentes, de webhooks et d'autorisation MCP sont des **tests backend à réaliser**.

## Hypothèses prudentes retenues (configurables, à valider)

| Hypothèse | Où |
|---|---|
| Devise de démonstration MGA, échelle 0 | `src/mocks/seed.ts` |
| Durée d'accès d'un achat à l'unité : 12 mois | `src/mocks/fixtures/catalog.ts` |
| Réservation de quota : 10 minutes (CON02) ; validité d'une proposition : 15 min | `src/contracts/rules.ts` |
| Changement de formule effectif à la prochaine échéance, sans prorata | `src/mocks/server.ts` |
| Fuseaux proposés (Madagascar, Réunion, Maurice, Paris, Montréal, UTC) ; défaut `Indian/Antananarivo` | `src/config/app.ts` |
| Téléchargement PDF autorisé pour un seul éditeur fictif, pour montrer le cas « si autorisé » | `src/mocks/demoApi.ts` |
| Extensions d'import indicatives `.pdf .md .txt`, 50 Mo | `src/config/app.ts` |
| Adresse de contact `contact@kiosy.invalid` (volontairement non routable) | `src/config/app.ts` |

## Limites restantes

- Les clés d'idempotence frontend sont reprises 24 h dans `sessionStorage`, uniquement dans le même onglet. Le backend conserve l'enregistrement autoritaire et doit permettre de retrouver une opération incertaine.
- Le téléchargement cross-origin dépend de CORS et `Content-Disposition` du stockage. Les origines sont listées dans `VITE_ASSET_ALLOWED_ORIGINS`.
- La purge locale peut précéder un échec de révocation serveur. L'interface le signale ; le risque de session encore active disparaît après confirmation serveur ou expiration.
- Documents versionnés, endpoint CSRF et créations admin HTTP restent des contrats proposés, pas un backend validé.

- Un seul jeu de traductions (français) ; aucune UI malgache/anglaise (pas de sélecteur de langue). Les chaînes de navigation sont externalisées dans `src/locales/fr.ts`, mais une partie des textes de pages reste dans le JSX.
- Accessibilité : conçue pour WCAG 2.2 AA (contrastes calculés, clavier, libellés, dialogues Radix, `prefers-reduced-motion`) et contrôlée par quelques tests clavier/structure. **Pas d'audit complet ni de certification** ; le lecteur PDF intégré (iframe) dépend du navigateur.
- Le PDF n'est pas paginé par l'application (visionneuse du navigateur).
- Espace éditeur autonome (P1) non réalisé : les frontières existent (rôle `publisher`, `publisher_id`), aucune route active.
- Audio, vidéo, cadeaux, organisations, récurrence, multilingue : P2, absents des parcours.
- Tests E2E exécutés sur le build servi en local, navigateur Chromium uniquement.
- Les 10 avertissements ESLint `react-refresh/only-export-components` sont sans impact en production.
