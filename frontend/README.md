# Kiosy — frontend

Frontend React/TypeScript de la plateforme Kiosy (catalogue, abonnements, assistant KIA, administration), réalisé d'après le *Cahier des charges v1.0*. Les noms **Kiosy** et **KIA** sont provisoires et centralisés dans [`src/config/app.ts`](src/config/app.ts).

> Le backend (FastAPI, agents LangGraph, serveurs MCP, paiement) **n'est pas inclus**. L'application fonctionne aujourd'hui en **mode démonstration** ; le mode `api` est prêt à être raccordé (voir [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md)).

## Démarrage

Prérequis : Node 20+ (testé avec Node 24, npm 11).

```bash
npm install
cp .env.example .env     # VITE_APP_MODE=demo par défaut
npm run dev              # http://localhost:5173
```

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` | `tsc -b` puis build de production dans `dist/` |
| `npm run preview` | sert `dist/` (port 4173) |
| `npm run typecheck` / `npm run lint` | TypeScript strict / ESLint |
| `npm test` | tests unitaires et d'intégration (Vitest) |
| `npm run test:e2e` | parcours E2E Playwright (desktop 1440 px + mobile 360 px) ; construit puis sert l'application |

Les E2E utilisent les navigateurs Playwright 1.62 (`npx playwright install chromium` si absent).

## Modes de données

| | `demo` (défaut) | `api` |
|---|---|---|
| Données | fictives, en mémoire, persistées dans `localStorage` | backend `VITE_API_BASE_URL` |
| Paiement | prestataire **simulé** (page « TestPay ») | celui du backend |
| KIA | scénarios scriptés, aucun LLM/MCP appelé | backend |
| Outils de démo | oui (persona, panne, réinitialisation) | **absents** |
| En cas de panne | panne simulable | erreur affichée, **jamais de repli sur des mocks** |

Toutes les variables `VITE_*` sont **publiques** (incluses dans le bundle) : aucun secret. Le build `api` ne contient ni données ni pages de démonstration (vérifié).

## Guide de la démonstration

Mot de passe commun des personas : `demo`. Le panneau « Outils de démo » (bandeau orange) permet de changer de persona, simuler une panne, faire expirer la session ou tout réinitialiser.

| Persona | E-mail | Situation |
|---|---|---|
| Hery (lecteur) | `hery@demo.kiosy.invalid` | abonnement Culture actif, Trimestriel N° 12 acheté, abonnement Presse expiré |
| Fara (lectrice) | `fara@demo.kiosy.invalid` | Presse résilié à échéance, commande au paiement incertain (KY-2026-0163), ticket ouvert |
| Nirina (support) | `support@demo.kiosy.invalid` | tickets, demande d'approbation |
| Voahangy (responsable) | `responsable@demo.kiosy.invalid` | approbations, audit |
| Tahina (admin) | `admin@demo.kiosy.invalid` | catalogue, offres, imports, diagnostic IA |

### Parcours à essayer

1. **Découverte et achat** — Hery : catalogue → *Lettre de l'export* → *Choisir cette offre* → cocher les conditions → *Confirmer* → *Payer* → « Accepter le paiement ». L'écran reste en « vérification » jusqu'à la notification simulée, puis l'accès apparaît. Essayez aussi « Ne jamais répondre » (statut incertain), « Refuser », « notification retardée ».
2. **Doublon** — Hery sur *Le Trimestriel de l'Entreprise* : accès déjà détenu, commande bloquée.
3. **Quota** — *Marchés & Filières* offre de lancement (2 places) : réservation avec échéance serveur ; admin : *Commandes* → réconciliation.
4. **Abonnement** — Hery : *Abonnements* → Culture → *Préparer la résiliation* (conséquences puis confirmation) ou *Simuler un changement*.
5. **Problème d'accès** — KIA : « Je n'arrive pas à ouvrir L'Écho du Matin » → diagnostic (accès expiré) → proposition de demande d'assistance à confirmer.
6. **KIA** : « Je veux une offre business et agriculture sans repayer mes accès » (limite du catalogue reconnue, proposition), « Compare les abonnements », « Comment fonctionne la résiliation ? » (citations ouvrables), « Test outil en panne », « Test proposition expirée business » (refus 409 après ~9 s).
7. **Administration** — Tahina : publier/suspendre une édition (transitions CAT04, motif obligatoire au retrait), importer un fichier (nom contenant « scan » = PDF sans texte), offres versionnées, diagnostic IA. Support → demande d'accès exceptionnel ; Voahangy → approbation (le demandeur ne peut pas approuver lui-même).

## Architecture

```
src/
  app/          routeur (chargement différé), layouts, frontière d'erreur
  components/   UI réutilisable (ui/), Cover SVG, SafeMarkdown, badges de statut
  config/       noms de marque, variables publiques
  contracts/    modèles TypeScript, erreurs normalisées, règles partagées
  features/     auth, catalog, offers, checkout, library, subscriptions, orders,
                support, account, assistant, proposals, administration, public, demo
  services/     interface KiosyApi, adaptateur HTTP, suivi d'événements de run, cache (TanStack Query)
  mocks/        « faux serveur » de démonstration (données, règles, scénarios KIA)
  content/      textes contractuels PROVISOIRES
  locales/      textes français externalisés
```

Choix notables : données serveur uniquement dans TanStack Query (pas de store global) ; clés de cache privées isolées par utilisateur et purgées à la déconnexion et sur 401 ; aucune mutation relancée automatiquement ; clé d'idempotence liée à l'intention (même intention = même clé) ; Markdown de l'assistant rendu sans HTML.

## Documentation

- [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md) — couverture des exigences
- [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) — contrats et endpoints attendus du backend
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — déploiement Vercel, sessions, CORS
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) — vérifications réellement exécutées
- [docs/LIMITS.md](docs/LIMITS.md) — simulé, dépendances backend, hypothèses et limites
- [docs/BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md) — passage de relais, invariants et questions backend
- [docs/FRONTEND_REVIEW.md](docs/FRONTEND_REVIEW.md) — défauts vérifiés, corrections, tests et limites
