import type { EditorialStatus, SubscriptionStatus } from "./models";

/**
 * Règles partagées affichées par l'interface. Le serveur reste l'autorité : ces tables
 * servent à proposer uniquement des actions plausibles, pas à les autoriser.
 */

/** CAT04 : transitions éditoriales autorisées. */
export const EDITORIAL_TRANSITIONS: Record<EditorialStatus, EditorialStatus[]> = {
  draft: ["review"],
  review: ["published", "draft"],
  published: ["suspended", "archived"],
  suspended: ["published", "archived"],
  archived: [],
};

/** États d'abonnement ouvrant l'accès (section 7). */
export const SUBSCRIPTION_GIVES_ACCESS: Record<SubscriptionStatus, boolean> = {
  pending_payment: false,
  active: true,
  cancel_at_period_end: true,
  past_due: false,
  expired: false,
  suspended: false,
};

/** Durée de réservation d'une place contingentée : hypothèse à tester (CON02). */
export const RESERVATION_DURATION_MS = 10 * 60 * 1000;

/** Durée de validité d'une proposition d'action (hypothèse configurable). */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;
