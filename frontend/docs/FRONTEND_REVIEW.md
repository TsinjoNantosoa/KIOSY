# Revue frontend — 1er octobre 2026

| Sujet | Constat vérifié | Correction | Preuve | Limite restante |
|---|---|---|---|---|
| Acceptation | Booléen conservé après changement du devis | Liaison à version/conditions/total, détail du changement, expiration et 409 réinitialisent | `CheckoutPage.tsx`, tests checkout | Validité décidée par l'API |
| Déconnexion | Purge en `onSettled`, résultat serveur indifférencié | Purge immédiate, échec visible/réessayable, diffusion inter-onglets | session/layout, tests | Cookie révoqué uniquement côté serveur |
| Session | Erreur GET assimilée à anonyme | État `unavailable` distinct, garde non redirigeante | session/guards | Expiration exacte dépend du 401 |
| Idempotence | Clé uniquement en `useRef` | Reprise 24 h en `sessionStorage`, isolée compte/opération/intention | idempotency + tests | Pas de partage entre onglets |
| Administration | Création d'offre et nouvelle édition absentes | Parcours démo et HTTP, historique conservé | pages admin + tests démo | Autorité backend nécessaire |
| Lecteur | Réautorisation sans état/erreur ni revalidation de permission | Anti-double clic, permission, expiration, origine et nettoyage | Reader/safeUrl | En-têtes stockage requis |
| Paiement | Textes de test figés avant mode autoritaire | Texte générique avant checkout, badge selon `payment.mode` | checkout/abonnement | TestPay reste démo uniquement |
| Configuration | Faute de mode basculait en démo | Validation stricte de `VITE_APP_MODE` | config | Variable absente = démo local documenté |
| HTTP | Assertions TypeScript seulement | Zod sur frontières critiques et `INVALID_RESPONSE` | schemas/http + tests | OpenAPI généré à adopter |
| CSRF | Lecture d'un cookie API supposée depuis l'app | Endpoint CSRF, jeton mémoire, credentials | http + handoff | À valider en staging |
| KIA | Attentes non suivies, « live » trop tôt | Suivi des attentes, live sur `onopen` | assistant/follower | Backend réel hors périmètre |
| Documents | Brouillons locaux seulement | Version dans le lien et contrat backend défini | Legal/handoff | Endpoint non implémenté |

Cette revue n'affirme ni sécurité complète ni aptitude production. Backend, paiement réel, agents, MCP et invariants transactionnels restent hors de cette livraison.
