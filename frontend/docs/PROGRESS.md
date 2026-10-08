# Progression — frontend Kiosy

Fichier de reprise. Mis à jour à chaque étape.

## Plan
1. Analyse du cahier des charges et du dépôt — FAIT (dépôt vide hors PDF ; frontend créé dans `Kiosy/frontend`).
2. Structure, contrats, design system — FAIT.
3. Catalogue et pages publiques — FAIT.
4. Authentification et espace lecteur — FAIT.
5. Commerce et abonnements — FAIT.
6. Assistant KIA — FAIT.
7. Administration et support — FAIT.
8. Revue frontend renforcée — FAIT (acceptation versionnée, session, reprise, admin, lecteur, contrats HTTP et documentation corrigés ; résultats de la passe dans `TEST_REPORT.md`).

## Décisions
- Stack : React 18, TypeScript strict, Vite 6, React Router 7, TanStack Query 5, RHF + Zod, Tailwind 3, Radix Dialog, Lucide, Vitest, Playwright 1.62.1 (navigateurs déjà présents sur le poste).
- Deux modes : `demo` (adaptateur en mémoire persistant dans localStorage, clairement signalé) et `api` (adaptateur HTTP, aucun repli sur les mocks).
- Montants : `{ amount, currency, scale }` entier ; démo en MGA avec `scale = 0` (ariary entiers).
- Pas de token en localStorage. En démo, seul l'identifiant de persona fictive est gardé en sessionStorage.

## État au 7 octobre 2026

La régression de double soumission checkout reproduite pendant la baseline a été corrigée dans le code, sans assouplir son assertion. TypeScript, lint, 48 tests Vitest, les deux builds et les 22 E2E de démonstration passent. Les limites et dépendances restent décrites dans `FRONTEND_REVIEW.md` et `BACKEND_HANDOFF.md`; aucune aptitude production ni validation du backend réel n'est revendiquée.
