# Bilan des vérifications

## Passe frontend du 1er octobre 2026

| Vérification réellement exécutée | Résultat |
|---|---|
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 0 erreur, 12 avertissements historiques `react-refresh/only-export-components` |
| `npm test -- --run` | ✅ 48/48, 11 fichiers |
| build `VITE_APP_MODE=demo` | ✅ |
| build `VITE_APP_MODE=api` avec URL/origine de test | ✅ ; aucun chunk DemoTools, TestProvider ou demoApi et aucun persona de démo après séparation finale |
| `npm run test:e2e` | ✅ 22/22 sur Chromium local : 20 desktop et 2 mobile 360 px |

Nouveaux tests : acceptation invalidée après 409, aucune nouvelle commande sans réacceptation, échec de révocation avec purge locale, reprise/idempotence isolée par compte, 401/403/409/422/429/503, réseau, annulation et réponse invalide, création d'offre, nouvelle édition, permission de téléchargement retirée, lien de téléchargement expiré et libellés de paiement. Ils valident le frontend et la simulation, pas le futur serveur.

Dernière passe complète : 1er octobre 2026, Windows 11, Node 24.13, Chromium (Playwright 1.62.1).

## Passe initiale de référence

| Vérification | Commande | Résultat |
|---|---|---|
| Types (TypeScript strict, `noUncheckedIndexedAccess`) | `npx tsc -b --noEmit` | ✅ 0 erreur |
| Lint | `npm run lint` | ✅ 0 erreur, 12 avertissements `react-refresh/only-export-components` (sans impact production) |
| Tests unitaires et d'intégration | `npm test` | ✅ 29/29 (7 fichiers) |
| Build de production | `npm run build` | ✅ ; routes secondaires en fragments chargés à la demande |
| E2E Playwright | `npm run test:e2e` | ✅ 22/22 (20 desktop 1440 px + 2 mobile 360 px), sur build frais |
| Débordement horizontal à 360 px | script Playwright ad hoc, 40 pages (public, lecteur, admin) | ✅ 0 page en débordement |
| Build en mode `api` | build avec `VITE_APP_MODE=api` | ✅ aucune donnée, aucun bandeau ni page de démonstration dans le bundle |
| Mode `api` sans backend | navigateur sur un build `api` | ✅ erreur « Connexion impossible » + « Réessayer », 0 publication fictive |
| Stabilité du test de déconnexion | `--repeat-each=10 --workers=4` | ✅ 10/10 (après correction d'une course réelle) |

## Parcours E2E (liste des 15 parcours demandés)

| # | Parcours | Test |
|---|---|---|
| 1 | Recherche, filtres (URL, rechargement, retour) | `catalog.spec` |
| 2 | Extrait autorisé | `catalog.spec` |
| 3 | Connexion de démo et bibliothèque | `purchase.spec`, `mobile.spec` |
| 4 | Achat de test puis apparition du droit | `purchase.spec` |
| 5 | Avertissement « déjà possédé » | `purchase.spec`, `CheckoutPage.test` |
| 6 | Offre indisponible | `catalog.spec` |
| 7 | Proposition périmée (409) | `assistant.spec`, `demoApi.test` |
| 8 | Double clic sans double soumission | `CheckoutPage.test` (1 seul appel) |
| 9 | Paiement incertain sans faux succès | `purchase.spec` |
| 10 | Résiliation avec conséquences | `purchase.spec` |
| 11 | KIA prépare une action à confirmer | `assistant.spec` |
| 12 | Reprise du suivi d'un run après rechargement | `assistant.spec`, `runFollower.test` |
| 13 | Déconnexion et purge du cache privé | `purchase.spec`, `session.test` |
| 14 | Administration d'une publication | `admin.spec` |
| 15 | Mobile et clavier | `mobile.spec` |

Couverts en plus : refus du paiement et nouvelle tentative, outil KIA indisponible, visiteur invité à se connecter, diagnostic d'accès, import de fichier suivi après rafraîchissement, séparation demandeur/approbateur, diagnostic IA sans métriques fictives, ouverture directe d'une URL interne.

## Défauts trouvés par ces vérifications puis corrigés

1. Retour de paiement servi depuis le cache (bouton « Payer » affiché après le retour, risque de double paiement) → relecture systématique du statut serveur.
2. Panneau KIA : la conversation fraîchement créée était oubliée (liste périmée) → suppression de la réinitialisation fondée sur la liste.
3. Filtres mobiles : identifiants dupliqués entre panneau latéral et bureau (champs sans nom accessible) → préfixes uniques.
4. Focus déplacé à l'ouverture de la page (lien « Aller au contenu » inaccessible au clavier) → focus déplacé uniquement lors des navigations.
5. Débordement horizontal sur l'espace lecteur/admin en 360 px (pistes de grille sans `minmax(0,1fr)`) → corrigé partout.
6. Déconnexion : la garde de route pouvait rediriger vers `/connexion` avant l'accueil → indicateur de déconnexion volontaire (10/10 en stress).
7. Couvertures SVG rognées ; intitulés d'offres renvoyés à la ligne.
8. « Compare les abonnements » capté par le scénario de souscription (KIA simulé).
9. Chunk de la page de paiement simulé présent dans le build `api`.
10. Logique de suivi d'événements : trou de séquence non relu tant que le flux restait ouvert.

## Ce que ces tests ne prouvent pas

Isolation serveur, quota atomique sous concurrence PostgreSQL, vérification des webhooks, sécurité MCP, absence de survente, performances (p95) et accessibilité complète (aucun audit WCAG ni test avec lecteur d'écran réel). Les tests du mode démo vérifient la cohérence de l'interface avec les règles du cahier des charges, pas un backend. Navigateur : Chromium uniquement ; pas de test Safari/Firefox ni sur appareil réel.
