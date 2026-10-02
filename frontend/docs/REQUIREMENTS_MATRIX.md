# Matrice de couverture des exigences (périmètre frontend)

État : ✅ réalisé et vérifié (test cité) · 🟡 réalisé côté interface, l'autorité est le backend · ⬜ hors périmètre frontend ou P1/P2 non activé.
« Vérif. » : **U** = Vitest, **E** = Playwright (`e2e/`), **M** = contrôle manuel/visuel.

| ID | Fonctionnalité | Écran / composant | Prio | Dépendance backend | État | Vérif. |
|---|---|---|---|---|---|---|
| OBJ01 | Trouver, consulter l'offre, achat de test | Catalogue → fiche → `CheckoutPage` → `OrderPaymentPage` | P0 | orders, checkout, webhook | 🟡 | E `purchase` |
| OBJ02 | Accès = périmètre exact de l'abonnement | `LibraryPage`, `ReaderPage` | P0 | entitlements | 🟡 | U `demoApi`, E |
| OBJ03–04 | Coopération multi-agent, MCP réels | `ConversationView`, `AdminRunPage` | P0 | agents, MCP | ⬜ simulé | E `assistant` (scénario) |
| OBJ05 | Mutation sensible après confirmation | `ProposalCard` | P0 | proposals/confirm | 🟡 | U, E |
| OBJ06 | Mesures du pilote | `AdminDashboard` (compteurs opérationnels) | P1 | métriques | ⬜ | — |
| IAM01–04 | Permissions, isolation | `guards.tsx`, clés de cache par utilisateur ; 403/404 gérés | P0 | **tous les contrôles** | 🟡 | U `session`, E `admin` |
| IAM05–06 | Support avec ticket+motif ; MFA | `AdminTicketPage` (motif, audit) | P1 | auth renforcée | ⬜/🟡 | E |
| CAT01 | Filtres, tri stable, pagination bornée, vide | `CatalogPage`, `catalogQuery.ts` (URL) | P0 | publications | ✅ | U, E `catalog` |
| CAT02 | Contenu inclus, restrictions, disponibilité | `OfferCard`, `PublicationPage`, `OffersPage` | P0 | offers | ✅ | E |
| CAT03 | Extrait public sans fichier complet | `ExcerptDialog` | P0 | excerpt | ✅ | E |
| CAT04 | draft→review→published→suspended/archived | `AdminEditionPage` (transitions, motif) | P0 | transitions | 🟡 | E `admin` |
| CAT05 | Import, validation, quarantaine | `AdminImports`, `uploadValidation.ts` | P0 | ingestion | 🟡 | E `admin` |
| CAT06–08 | Dépôt éditeur, retrait synchronisé, audio/vidéo | — | P1/P2 | — | ⬜ | — |
| OFF01–02 | Offres versionnées, total serveur | `AdminOfferPage`, `Quote` (prix jamais calculés client) | P0 | offers | 🟡 | U |
| OFF03 | Quota seulement si contingenté | `OfferCard` (quota conditionnel) | P0 | quota | 🟡 | U `demoApi` |
| OFF04 | Signaler doublon / chevauchement | `OfferCard`, `CheckoutPage`, `OffersPage` | P0 | eligibility | ✅ | U, E |
| OFF05 | Dates UTC affichées dans le fuseau choisi | `lib/format.ts`, `ProfilePage` | P0 | — | ✅ | U `format` |
| OFF06 | Taxes, territoire, devise | — | P1 | prestataire | ⬜ | — |
| SUB01 | État, dates, contenu, renouvellement | `SubscriptionDetailPage` | P0 | subscriptions | ✅ | E |
| SUB02–03 | Activation sur preuve ; dates contrôlées à chaque lecture | `OrderPaymentPage` (statut serveur) | P0 | paiement | 🟡 | U, E |
| SUB04 | Renouvellement manuel explicite | `SubscriptionDetailPage`, `CheckoutPage` | P0 | orders | ✅ | E |
| SUB05 | Résiliation à échéance, historique | `SubscriptionDetailPage` + `ProposalCard` | P0 | proposals | 🟡 | E, U |
| SUB06–07 | Changement de formule, récurrence | changement simulé (devis serveur) ; récurrence absente | P1 | — | 🟡/⬜ | U |
| PAY01–02 | Connecteur, adaptateur de test explicite | `TestProviderPage` (badge TEST) | P0 | provider | 🟡 | E |
| PAY05 | Retour navigateur ≠ preuve | `OrderPaymentPage` relit `GET /orders/{id}` (paramètres ignorés) | P0 | webhook | ✅ | E `purchase` (attente, incertain, refus) |
| PAY03–04, 06–07 | Prestataire réel, signature, réconciliation | bouton « Réconcilier » (admin) | P1 | backend | ⬜/🟡 | E |
| CON01–03 | Quota atomique, expiration | compte à rebours sur échéance **serveur** ; bouton désactivé à l'envoi | P0 | PostgreSQL | 🟡 | U (simulation) |
| CON04 | Idempotency-Key | `lib/idempotency.ts` (même intention = même clé) | P0 | API | ✅ | U `demoApi`, `CheckoutPage` |
| CON05 | Unicité, effets idempotents | backend | P0 | backend | ⬜ | — |
| UX01 | Responsive ≥ 360 px, clavier, focus, labels | toute l'application | P0 | — | ✅ | E `mobile` (40 pages sans débordement, mesuré) |
| UX02 | Prix/durée/renouvellement avant confirmation, rien de présélectionné | `CheckoutPage`, `OffersPage` | P0 | — | ✅ | U, E |
| UX03 | 5 états distincts dans KIA | `ProposalCard`, `MessageBlocks` | P0 | — | ✅ | E `assistant` |
| UX04 | Cartes comparatives, sources ouvrables, formulaires classiques | `MessageBlocks` ; chaque action a son formulaire | P0 | — | ✅ | E |
| UX05 | Reprise de conversation et de tâche | `panelState`, `useRunFollower`, `active_run_id` | P0 | runs | ✅ | E (rechargement) |
| UX06 | Réseau lent, couvertures différées | `cv-auto`, SVG, routes lazy | P1 | — | 🟡 | M |
| AG01–07 | Orchestration | backend ; UI : étapes publiques, statuts `RunStatus`, « preuve d'exécution » = `result` de la proposition | P0 | LangGraph | ⬜/🟡 | E |
| MCP01–02, SAFE01–05 | Sécurité MCP / approbations | backend ; UI transmet `proposal_id` + idempotence, jamais un booléen | P0 | backend | ⬜/🟡 | U, E |
| SEC01–08 | Sécurité applicative | pas de secret, pas de token en storage, Markdown sans HTML, liens contrôlés, purge du cache, `safeReturnPath` | P0 | backend | 🟡 | U `SafeMarkdown`, `session` |
| API01–03 | Erreurs typées, 202 + suivi, bornes | `ApiError`, `runFollower`, limites de saisie | P0 | OpenAPI | 🟡 | U |
| RAG01–03 | Recherche documentaire | citations et passages ouvrables (`/conditions/...#section`) | P0 | backend | ⬜/🟡 | E |
| OBS01–02 | Observabilité | `AdminRunPage` (coût mesuré ≠ estimé ≠ indisponible), `request_id` affiché | P0 | backend | 🟡 | E |
| INF01–03 | Déploiement Vercel | `vercel.json`, [DEPLOYMENT.md](DEPLOYMENT.md) | P0 | — | 🟡 | build |
| Accessibilité | WCAG 2.2 AA (conception) | voir [LIMITS.md](LIMITS.md) | P0 | — | 🟡 | E clavier, M |
| Revue checkout | Acceptation liée au devis et conditions, expiration/409 | `CheckoutPage` | P0 | devis autoritaire | 🟡 | U `CheckoutPage` |
| Reprise mutation | Clé isolée compte/intention, reprise même onglet 24 h | `lib/idempotency.ts` | P0 | registre serveur | 🟡 | U `idempotency` |
| Admin création | Offre complète et nouvelle édition | pages administration | P0 | endpoints admin proposés | 🟡 | U `demoApi` |
| Validation HTTP | Schémas session/commerce/proposition/fichier/run | `contracts/schemas.ts`, `api/http.ts` | P0 | OpenAPI futur | 🟡 | U `http` |
