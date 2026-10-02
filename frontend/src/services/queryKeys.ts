import type { CatalogQuery } from "@/contracts/models";

/**
 * Clés TanStack Query. Toute donnée personnelle est rangée sous ["me", userId, ...] ou
 * ["admin", userId, ...] : elle est isolée par compte et purgée à la déconnexion.
 */
export const qk = {
  session: ["session"] as const,
  catalog: (query: CatalogQuery) => ["catalog", query] as const,
  featured: ["catalog", "featured"] as const,
  publication: (idOrSlug: string) => ["publication", idOrSlug] as const,
  excerpt: (editionId: string) => ["excerpt", editionId] as const,
  offers: (filter: { publication_id?: string }) => ["offers", filter] as const,
  offer: (offerId: string) => ["offer", offerId] as const,

  me: (uid: string) => ["me", uid] as const,
  library: (uid: string) => ["me", uid, "library"] as const,
  access: (uid: string, publicationId: string) => ["me", uid, "access", publicationId] as const,
  eligibility: (uid: string, offerIds: string[]) => ["me", uid, "eligibility", [...offerIds].sort()] as const,
  asset: (uid: string, editionId: string) => ["me", uid, "asset", editionId] as const,
  orders: (uid: string) => ["me", uid, "orders"] as const,
  order: (uid: string, orderId: string) => ["me", uid, "order", orderId] as const,
  quote: (uid: string, offerId: string, renewal: string | null) => ["me", uid, "quote", offerId, renewal] as const,
  subscriptions: (uid: string) => ["me", uid, "subscriptions"] as const,
  subscription: (uid: string, id: string) => ["me", uid, "subscription", id] as const,
  cases: (uid: string) => ["me", uid, "cases"] as const,
  supportCase: (uid: string, id: string) => ["me", uid, "case", id] as const,
  sessions: (uid: string) => ["me", uid, "sessions"] as const,
  proposal: (uid: string, id: string) => ["me", uid, "proposal", id] as const,
  conversations: (uid: string) => ["me", uid, "conversations"] as const,
  conversation: (uid: string, id: string) => ["me", uid, "conversation", id] as const,
  messages: (uid: string, id: string) => ["me", uid, "messages", id] as const,
  run: (uid: string, id: string) => ["me", uid, "run", id] as const,

  admin: (uid: string, ...rest: unknown[]) => ["admin", uid, ...rest] as const,
};

export const PRIVATE_ROOTS = ["me", "admin"] as const;
