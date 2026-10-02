import { ApiError } from "@/contracts/errors";
import type {
  ActionProposal,
  AuditEvent,
  Edition,
  Eligibility,
  Entitlement,
  LibraryItem,
  Offer,
  Order,
  Publication,
  Role,
  RunEvent,
  Subscription,
  SupportCase,
} from "@/contracts/models";
import { PROPOSAL_TTL_MS, RESERVATION_DURATION_MS, SUBSCRIPTION_GIVES_ACCESS } from "@/contracts/rules";
import {
  clock,
  getDb,
  getDemoSessionUserId,
  isoIn,
  nextId,
  setDemoSessionUserId,
  type DemoDb,
  type DemoUser,
  type OwnedOrder,
  type OwnedProposal,
  type OwnedSubscription,
  type PaymentSession,
} from "./db";
import { DEMO_PUBLICATIONS } from "./fixtures/catalog";
import { auditEvent, snapshotOf, UNIVERSE_LABEL } from "./seed";

/**
 * Règles métier simulées du backend. Elles reproduisent les invariants du cahier des charges
 * pour que l'interface puisse être démontrée honnêtement ; elles NE remplacent PAS les contrôles
 * serveur réels (droits, quotas atomiques, webhooks, autorisations MCP).
 */

// ------------------------------------------------------------------ erreurs

export function fail(status: number, code: string, message: string, details?: { field?: string; issue: string }[]): never {
  throw new ApiError(status, { code, message, request_id: `demo_${Math.random().toString(36).slice(2, 10)}`, details });
}

// ------------------------------------------------------------------ identité

export function currentUser(db: DemoDb): DemoUser | null {
  const id = getDemoSessionUserId();
  return id ? (db.users.find((u) => u.id === id) ?? null) : null;
}

export function requireUser(db: DemoDb): DemoUser {
  const user = currentUser(db);
  if (user) return user;
  if (db.flags.session_expired) {
    db.flags.session_expired = false;
    fail(401, "SESSION_EXPIRED", "Votre session a expiré. Reconnectez-vous pour continuer.");
  }
  return fail(401, "AUTH_REQUIRED", "Connexion requise.");
}

export function hasRole(user: DemoUser, roles: Role[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

export function requireRole(db: DemoDb, roles: Role[]): DemoUser {
  const user = requireUser(db);
  if (!hasRole(user, roles)) {
    db.audit.unshift(
      auditEvent(clock.iso(), actorOf(user), "access.denied", { type: "route", id: roles.join(","), label: "Espace réservé" }, "Rôle insuffisant.", "denied"),
    );
    fail(403, "ACCESS_DENIED", "Vous n'avez pas les droits nécessaires pour cette opération.");
  }
  return user;
}

export function actorOf(user: DemoUser): AuditEvent["actor"] {
  const role = (["admin", "manager", "support", "publisher", "reader"] as const).find((r) => user.roles.includes(r)) ?? "reader";
  return { id: user.id, label: user.display_name, role };
}

export function logout(): void {
  setDemoSessionUserId(null);
}

// ------------------------------------------------------------------ idempotence (CON04)

export function withIdempotency<T>(db: DemoDb, userId: string, operation: string, key: string, body: unknown, run: () => T): T {
  if (!key) fail(422, "VALIDATION_ERROR", "Clé d'idempotence manquante.");
  const recordKey = `${userId}:${operation}:${key}`;
  const fingerprint = JSON.stringify(body ?? null);
  const existing = db.idempotency[recordKey];
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      fail(409, "IDEMPOTENCY_MISMATCH", "Cette clé d'idempotence a déjà été utilisée pour une autre demande.");
    }
    return existing.result as T;
  }
  const result = run();
  db.idempotency[recordKey] = { fingerprint, result: structuredCloneSafe(result) };
  return result;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ------------------------------------------------------------------ formats serveur

export function formatDateFor(user: DemoUser | null, iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: user?.preferences.time_zone ?? "Indian/Antananarivo",
  }).format(new Date(iso));
}

export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function durationMonths(offer: { duration: Offer["duration"] }): number {
  if (!offer.duration) return 0;
  if (offer.duration.unit === "year") return offer.duration.count * 12;
  if (offer.duration.unit === "day") return offer.duration.count / 30;
  return offer.duration.count;
}

// ------------------------------------------------------------------ catalogue et accès

export function publicationOf(db: DemoDb, edition: Edition): Publication {
  const publication = db.publications.find((p) => p.id === edition.publication_id);
  if (!publication) fail(404, "NOT_FOUND", "Publication introuvable.");
  return publication;
}

export function isPublic(edition: Edition): boolean {
  return edition.status === "published";
}

export function isSellable(edition: Edition): boolean {
  return isPublic(edition) && edition.availability.state === "available";
}

function isCurrentlyValid(e: Entitlement): boolean {
  const now = clock.now();
  return e.status === "active" && Date.parse(e.valid_from) <= now && (!e.valid_until || Date.parse(e.valid_until) > now);
}

export function activeEntitlements(db: DemoDb, userId: string): Entitlement[] {
  return db.entitlements.filter((e) => e.user_id === userId && isCurrentlyValid(e));
}

export function entitlementCovers(db: DemoDb, e: Entitlement, edition: Edition): boolean {
  if (e.scope.kind === "edition") return e.scope.edition_id === edition.id;
  const scope = e.scope;
  const publication = db.publications.find((p) => p.id === edition.publication_id);
  return Boolean(publication && publication.universe === scope.universe && isPublic(edition));
}

/** Contrôle effectué à chaque demande de contenu protégé (section 6, SUB03). */
export function readAccess(db: DemoDb, user: DemoUser | null, edition: Edition): Entitlement | "free" | null {
  if (!isPublic(edition)) return null;
  if (edition.is_free && edition.availability.state === "available") return "free";
  if (!user) return null;
  return activeEntitlements(db, user.id).find((e) => entitlementCovers(db, e, edition)) ?? null;
}

export function editionMarkdown(db: DemoDb, edition: Edition): string {
  const publication = publicationOf(db, edition);
  const fixture = DEMO_PUBLICATIONS.find((p) => p.id === publication.id);
  const body = fixture?.body ?? publication.summary;
  return `# ${publication.title}\n\n*${edition.label} — ${publication.publisher.name}. Contenu de démonstration fictif.*\n\n${body}\n`;
}

export function libraryFor(db: DemoDb, userId: string): LibraryItem[] {
  const items = new Map<string, LibraryItem>();
  const rank = (e: Entitlement) => (isCurrentlyValid(e) ? 2 : e.status === "expired" ? 1 : 0);
  for (const entitlement of db.entitlements.filter((e) => e.user_id === userId)) {
    const covered =
      entitlement.scope.kind === "edition"
        ? db.editions.filter((ed) => ed.id === (entitlement.scope as { edition_id: string }).edition_id)
        : db.editions.filter((ed) => {
            if (!isPublic(ed) || !entitlementCovers(db, entitlement, ed)) return false;
            const end = entitlement.valid_until ? Date.parse(entitlement.valid_until) : clock.now();
            return Date.parse(ed.published_at) <= Math.min(end, clock.now());
          });
    for (const edition of covered) {
      const existing = items.get(edition.id);
      if (!existing || rank(entitlement) > rank(existing.entitlement)) {
        items.set(edition.id, { edition, publication: publicationOf(db, edition), entitlement });
      }
    }
  }
  return [...items.values()].sort((a, b) => Date.parse(b.edition.published_at) - Date.parse(a.edition.published_at));
}

// ------------------------------------------------------------------ éligibilité (OFF04)

export function findOffer(db: DemoDb, offerId: string): Offer {
  const offer = db.offers.find((o) => o.id === offerId);
  if (!offer) fail(404, "NOT_FOUND", "Offre introuvable.");
  return offer;
}

export function eligibility(db: DemoDb, user: DemoUser | null, offer: Offer, renewalOf: string | null = null): Eligibility {
  const result: Eligibility = {
    offer_id: offer.id,
    can_purchase: false,
    already_owned: false,
    blocking_reason: null,
    overlaps: [],
    pending_order_id: null,
  };
  if (offer.kind === "free") return { ...result, blocking_reason: "FREE_CONTENT" };
  if (offer.status === "unavailable" || offer.status === "retired") return { ...result, blocking_reason: "OFFER_UNAVAILABLE" };
  if (offer.scope.kind === "edition") {
    const edition = db.editions.find((e) => e.id === (offer.scope as { edition_id: string }).edition_id);
    if (!edition || !isSellable(edition)) return { ...result, blocking_reason: "OFFER_UNAVAILABLE" };
  }
  if (offer.status === "sold_out" || (offer.quota && offer.quota.remaining <= 0)) return { ...result, blocking_reason: "OFFER_SOLD_OUT" };
  if (!user) return { ...result, blocking_reason: "AUTH_REQUIRED" };

  const pending = db.orders.find(
    (o) => o.user_id === user.id && o.status === "pending_payment" && o.lines.some((l) => l.snapshot.offer_id === offer.id),
  );
  if (pending) return { ...result, blocking_reason: "PENDING_ORDER", pending_order_id: pending.id };

  const active = activeEntitlements(db, user.id);
  if (offer.scope.kind === "edition") {
    const edition = db.editions.find((e) => e.id === (offer.scope as { edition_id: string }).edition_id)!;
    const purchased = active.find((e) => e.source !== "subscription" && entitlementCovers(db, e, edition));
    const sameEditionOffers = db.offers.filter((o) => o.scope.kind === "edition" && o.scope.edition_id === edition.id).map((o) => o.id);
    const orderedLimited =
      offer.quota !== null &&
      db.orders.some((o) => o.user_id === user.id && o.status !== "cancelled" && o.lines.some((l) => sameEditionOffers.includes(l.snapshot.offer_id)));
    if (purchased || orderedLimited) return { ...result, already_owned: true, blocking_reason: "ALREADY_OWNED" };
    for (const e of active.filter((x) => x.source === "subscription" && entitlementCovers(db, x, edition))) {
      result.overlaps.push({
        entitlement_id: e.id,
        description: `Votre abonnement « ${e.scope.kind === "collection" ? e.scope.label : ""} » couvre déjà cette édition jusqu'au ${formatDateFor(user, e.valid_until ?? clock.iso())}. Un achat à l'unité prolongerait l'accès au-delà de cette date.`,
      });
    }
  } else if (offer.scope.kind === "collection") {
    const universe = offer.scope.universe;
    const activeSub = db.subscriptions.find(
      (s) => s.user_id === user.id && s.universe === universe && SUBSCRIPTION_GIVES_ACCESS[s.status],
    );
    if (activeSub && renewalOf !== activeSub.id) {
      return { ...result, already_owned: true, blocking_reason: "ALREADY_OWNED" };
    }
    const singles = active.filter(
      (e) => e.source === "purchase" && e.scope.kind === "edition" && db.editions.some((ed) => ed.id === (e.scope as { edition_id: string }).edition_id && entitlementCovers(db, { ...e, scope: { kind: "collection", universe, label: "" } }, ed)),
    );
    if (singles.length > 0) {
      result.overlaps.push({
        entitlement_id: singles[0]!.id,
        description: `Vous possédez déjà ${singles.length} édition(s) de l'univers ${UNIVERSE_LABEL[universe]} achetée(s) à l'unité. Elles restent accessibles selon leur propre durée ; l'abonnement les couvre aussi pendant sa période.`,
      });
    }
  }
  return { ...result, can_purchase: true };
}

export function blockingMessage(reason: NonNullable<Eligibility["blocking_reason"]>): { status: number; message: string } {
  switch (reason) {
    case "ALREADY_OWNED":
      return { status: 409, message: "Vous disposez déjà de cet accès." };
    case "OFFER_SOLD_OUT":
      return { status: 409, message: "Cette offre est épuisée." };
    case "OFFER_UNAVAILABLE":
      return { status: 409, message: "Cette offre n'est plus disponible." };
    case "AUTH_REQUIRED":
      return { status: 401, message: "Connexion requise." };
    case "FREE_CONTENT":
      return { status: 409, message: "Ce contenu est gratuit : aucune commande n'est nécessaire." };
    case "PENDING_ORDER":
      return { status: 409, message: "Une commande est déjà en attente de paiement pour cette offre." };
  }
}

// ------------------------------------------------------------------ commandes (section 8 et 9)

export function createOrderInternal(
  db: DemoDb,
  user: DemoUser,
  input: { offer_id: string; offer_version: number; renewal_of_subscription_id?: string | null; accepted_conditions_version: string },
): OwnedOrder {
  const offer = findOffer(db, input.offer_id);
  if (offer.version !== input.offer_version) {
    fail(409, "OFFER_CHANGED", "L'offre a été modifiée depuis son affichage. Vérifiez le nouveau récapitulatif.");
  }
  if (offer.conditions_version !== input.accepted_conditions_version) {
    fail(409, "OFFER_CHANGED", "Les conditions ont changé : une nouvelle acceptation est nécessaire.");
  }
  const renewalOf = input.renewal_of_subscription_id ?? null;
  if (renewalOf) {
    const sub = db.subscriptions.find((s) => s.id === renewalOf && s.user_id === user.id);
    if (!sub) fail(404, "NOT_FOUND", "Abonnement introuvable.");
    if (sub.offer.offer_id !== offer.id) fail(422, "VALIDATION_ERROR", "Le renouvellement doit porter sur la même offre.");
  }
  const elig = eligibility(db, user, offer, renewalOf);
  if (elig.blocking_reason) {
    const { status, message } = blockingMessage(elig.blocking_reason);
    fail(status, elig.blocking_reason, message);
  }

  // Décrément conditionnel atomique du quota (CON01) : ici séquentiel, en mémoire.
  let reservation: Order["reservation"] = null;
  if (offer.quota) {
    if (offer.quota.remaining <= 0) fail(409, "OFFER_SOLD_OUT", "Cette offre est épuisée.");
    offer.quota.remaining -= 1;
    reservation = { status: "reserved", expires_at: isoIn(RESERVATION_DURATION_MS) };
  }
  const now = clock.iso();
  db.counter += 1;
  const order: OwnedOrder = {
    id: nextId("ord"),
    reference: `KY-2026-${String(db.counter).padStart(4, "0")}`,
    user_id: user.id,
    status: "pending_payment",
    lines: [{ label: offer.title, snapshot: snapshotOf(offer), amount: offer.price }],
    total: offer.price,
    created_at: now,
    updated_at: now,
    payment: null,
    reservation,
    subscription_id: renewalOf,
    edition_id: offer.scope.kind === "edition" ? offer.scope.edition_id : null,
    renewal_of_subscription_id: renewalOf,
    receipt_available: false,
    exception_reason: null,
    is_demo: true,
  };
  db.orders.unshift(order);
  db.audit.unshift(auditEvent(now, actorOf(user), "order.create", { type: "order", id: order.id, label: order.reference }, null, "success"));
  return order;
}

export function toPublicOrder(order: OwnedOrder): Order {
  const { user_id: _user, ...rest } = order;
  return structuredCloneSafe(rest);
}

function fulfill(db: DemoDb, order: OwnedOrder): void {
  const snapshot = order.lines[0]!.snapshot;
  const offer = findOffer(db, snapshot.offer_id);
  const now = clock.iso();
  order.status = "paid";
  if (offer.scope.kind === "edition") {
    db.entitlements.push({
      id: nextId("ent"),
      user_id: order.user_id,
      source: "purchase",
      source_ref: order.id,
      scope: { kind: "edition", edition_id: offer.scope.edition_id },
      valid_from: now,
      valid_until: addMonths(now, durationMonths(snapshot)),
      status: "active",
    });
  } else if (offer.scope.kind === "collection") {
    const months = durationMonths(snapshot);
    const existing = order.renewal_of_subscription_id
      ? db.subscriptions.find((s) => s.id === order.renewal_of_subscription_id)
      : undefined;
    if (existing) {
      const base = Date.parse(existing.current_period_end) > clock.now() ? existing.current_period_end : now;
      existing.current_period_end = addMonths(base, months);
      if (existing.status !== "active") existing.current_period_start = base;
      existing.status = "active";
      existing.version += 1;
      existing.history.push({ at: now, label: `Renouvellement manuel confirmé (commande ${order.reference}).` });
      const ent = db.entitlements.find((e) => e.source_ref === existing.id);
      if (ent) {
        ent.valid_until = existing.current_period_end;
        ent.status = "active";
      } else {
        db.entitlements.push(collectionEntitlement(order.user_id, existing, now));
      }
      order.subscription_id = existing.id;
    } else {
      const sub: OwnedSubscription = {
        id: nextId("sub"),
        user_id: order.user_id,
        version: 1,
        offer: snapshot,
        universe: offer.scope.universe,
        status: "active",
        current_period_start: now,
        current_period_end: addMonths(now, months),
        renewal: "manual",
        scope_label: offer.scope.label,
        scheduled_change: null,
        history: [{ at: now, label: `Abonnement activé après confirmation du paiement (commande ${order.reference}).` }],
      };
      db.subscriptions.unshift(sub);
      db.entitlements.push(collectionEntitlement(order.user_id, sub, now));
      order.subscription_id = sub.id;
    }
  }
  if (order.reservation) order.reservation.status = "consumed";
  order.status = "fulfilled";
  order.updated_at = now;
  db.audit.unshift(
    auditEvent(now, { id: "system", label: "Traitement des paiements", role: "system" }, "order.fulfill", { type: "order", id: order.id, label: order.reference }, "Notification de paiement de test vérifiée.", "success"),
  );
}

function collectionEntitlement(userId: string, sub: Subscription, now: string): Entitlement {
  return {
    id: nextId("ent"),
    user_id: userId,
    source: "subscription",
    source_ref: sub.id,
    scope: { kind: "collection", universe: sub.universe, label: sub.scope_label },
    valid_from: now,
    valid_until: sub.current_period_end,
    status: "active",
  };
}

/** Traitement d'une notification du prestataire (simulée) : déduplication et ordre non garanti (PAY05). */
export function deliverPayment(db: DemoDb, session: PaymentSession, outcome: "succeeded" | "failed" | "cancelled"): void {
  if (session.delivered) return;
  session.delivered = true;
  const order = db.orders.find((o) => o.id === session.order_id);
  if (!order) return;
  const now = clock.iso();
  if (order.status === "fulfilled" || order.status === "paid") return;
  if (outcome !== "succeeded") {
    order.payment = { status: outcome, provider: "test", mode: "test", updated_at: now };
    order.updated_at = now;
    return;
  }
  order.payment = { status: "succeeded", provider: "test", mode: "test", updated_at: now };
  if (order.status === "cancelled" && order.reservation?.status === "expired") {
    // Paiement arrivé après expiration de la réservation : réattribution atomique si possible.
    const offer = findOffer(db, order.lines[0]!.snapshot.offer_id);
    if (offer.quota && offer.quota.remaining > 0) {
      offer.quota.remaining -= 1;
      order.reservation = { status: "reserved", expires_at: now };
      fulfill(db, order);
    } else {
      order.status = "payment_exception";
      order.exception_reason =
        "Paiement reçu après l'expiration de votre réservation, alors que plus aucune place n'était disponible. Un responsable traite ce dossier (remboursement ou compensation).";
      order.updated_at = now;
    }
    return;
  }
  fulfill(db, order);
}

// ------------------------------------------------------------------ tâches planifiées (tick)

/** Équivalent des workers : expiration, notifications, imports et progression des runs. */
export function tick(db: DemoDb = getDb()): void {
  const now = clock.now();
  const nowIso = clock.iso();

  for (const p of db.proposals) {
    if (p.status === "pending" && Date.parse(p.expires_at) <= now) p.status = "expired";
  }

  for (const order of db.orders) {
    if (order.reservation?.status === "reserved" && order.status === "pending_payment" && Date.parse(order.reservation.expires_at) <= now) {
      order.reservation.status = "expired";
      const offer = db.offers.find((o) => o.id === order.lines[0]!.snapshot.offer_id);
      if (offer?.quota) offer.quota.remaining += 1; // restitution unique (CON02)
      order.status = "cancelled";
      order.exception_reason = "Réservation expirée avant la confirmation du paiement.";
      order.updated_at = nowIso;
    }
  }

  for (const session of db.payment_sessions) {
    if (session.outcome && session.outcome !== "no_response" && session.deliver_at && !session.delivered && Date.parse(session.deliver_at) <= now) {
      deliverPayment(db, session, session.outcome);
    }
  }

  for (const sub of db.subscriptions) {
    if (SUBSCRIPTION_GIVES_ACCESS[sub.status] && Date.parse(sub.current_period_end) <= now) {
      sub.status = "expired";
      sub.version += 1;
      sub.history.push({ at: sub.current_period_end, label: "Période terminée : accès expiré." });
    }
  }
  for (const e of db.entitlements) {
    if (e.status === "active" && e.valid_until && Date.parse(e.valid_until) <= now) e.status = "expired";
  }

  for (const job of db.imports) {
    if (job.status === "ready" || job.status === "failed") continue;
    const reached = job.schedule.filter((s) => Date.parse(s.at) <= now);
    const last = reached[reached.length - 1];
    if (last) {
      job.status = last.status;
      job.progress = last.progress;
      job.updated_at = last.at;
      if (last.status === "failed") job.error = job.final_error;
      if (last.status === "ready" && job.edition_id) {
        const edition = db.editions.find((e) => e.id === job.edition_id);
        if (edition) edition.asset_id = `asset_${job.id}`;
      }
    }
  }

  for (const run of db.runs) {
    const visible = run.events.filter((e) => Date.parse(e.at) <= now);
    applyRunEvents(run, visible);
    const conversation = db.conversations.find((c) => c.id === run.conversation_id);
    if (conversation && conversation.active_run_id === run.id && !["queued", "running"].includes(run.status)) {
      conversation.active_run_id = null;
    }
  }
}

export function applyRunEvents(run: { status: string; steps: { key: string; label: string; state: string }[]; last_seq: number; updated_at: string; error: { code: string; message: string } | null }, events: RunEvent[]) {
  for (const event of events) {
    if (event.seq <= run.last_seq) continue;
    run.last_seq = event.seq;
    run.updated_at = event.at;
    if (event.type === "status") run.status = event.status;
    if (event.type === "error") run.error = { code: event.code, message: event.message };
    if (event.type === "step") {
      const existing = run.steps.find((s) => s.key === event.step.key);
      if (existing) existing.state = event.step.state;
      else run.steps.push({ ...event.step });
    }
  }
}

// ------------------------------------------------------------------ propositions (section 7, SAFE01-05)

function baseProposal(user: DemoUser, fields: Omit<OwnedProposal, "id" | "user_id" | "status" | "created_at" | "result">): OwnedProposal {
  return {
    id: nextId("prop"),
    user_id: user.id,
    status: "pending",
    created_at: clock.iso(),
    result: null,
    ...fields,
  };
}

export function createPurchaseProposal(
  db: DemoDb,
  user: DemoUser,
  offer: Offer,
  origin: ActionProposal["origin"],
  runId: string | null,
  ttlMs = PROPOSAL_TTL_MS,
): OwnedProposal {
  const elig = eligibility(db, user, offer);
  const consequences = [
    `Une commande sera créée pour « ${offer.title} » au prix de l'offre en vigueur.`,
    "Aucun paiement n'est effectué à cette étape : vous serez redirigé vers le paiement de test.",
    offer.kind === "subscription"
      ? `Accès à ${offer.scope.label} pendant ${offer.duration?.count ?? 1} mois après confirmation du paiement ; renouvellement manuel, sans prélèvement automatique.`
      : `Accès à l'édition pendant ${offer.duration?.count ?? 12} mois après confirmation du paiement.`,
    ...elig.overlaps.map((o) => o.description),
  ];
  const proposal = baseProposal(user, {
    type: "purchase",
    title: `Préparer la commande : ${offer.title}`,
    resource: { type: "offer", id: offer.id, label: offer.title, version: offer.version },
    consequences,
    amount: offer.price,
    conditions_version: offer.conditions_version,
    expires_at: isoIn(ttlMs),
    approval: "self",
    origin,
    payload: { offer_id: offer.id, offer_version: offer.version },
    run_id: runId,
  });
  db.proposals.push(proposal);
  return proposal;
}

export function createCancellationProposal(db: DemoDb, user: DemoUser, sub: OwnedSubscription, origin: ActionProposal["origin"], runId: string | null): OwnedProposal {
  if (sub.status !== "active") fail(409, "INVALID_TRANSITION", "Seul un abonnement actif peut être résilié.");
  const proposal = baseProposal(user, {
    type: "cancel_subscription",
    title: `Résilier : ${sub.offer.title}`,
    resource: { type: "subscription", id: sub.id, label: sub.offer.title, version: sub.version },
    consequences: [
      `Aucun renouvellement ne sera proposé. Votre accès reste ouvert jusqu'au ${formatDateFor(user, sub.current_period_end)}.`,
      "Après cette date, les éditions incluses ne seront plus lisibles, sauf achats à l'unité.",
      "Votre historique de commandes est conservé.",
      "Aucun remboursement automatique : une demande exceptionnelle passe par l'assistance.",
    ],
    amount: null,
    conditions_version: sub.offer.conditions_version,
    expires_at: isoIn(PROPOSAL_TTL_MS),
    approval: "self",
    origin,
    payload: { subscription_id: sub.id },
    run_id: runId,
  });
  db.proposals.push(proposal);
  return proposal;
}

export function createPlanChangeProposal(db: DemoDb, user: DemoUser, sub: OwnedSubscription, target: Offer): OwnedProposal {
  if (!SUBSCRIPTION_GIVES_ACCESS[sub.status]) fail(409, "INVALID_TRANSITION", "L'abonnement n'est pas actif.");
  if (target.kind !== "subscription" || target.id === sub.offer.offer_id) fail(422, "VALIDATION_ERROR", "Formule cible invalide.");
  const proposal = baseProposal(user, {
    type: "change_plan",
    title: `Changer de formule : ${target.title}`,
    resource: { type: "subscription", id: sub.id, label: sub.offer.title, version: sub.version },
    consequences: [
      `Le changement prendra effet à la prochaine échéance, le ${formatDateFor(user, sub.current_period_end)}. Aucun prorata n'est calculé.`,
      `Jusqu'à cette date, « ${sub.offer.title} » reste inchangé.`,
      `Le prix de la nouvelle formule s'appliquera lors du prochain renouvellement manuel.`,
    ],
    amount: target.price,
    conditions_version: target.conditions_version,
    expires_at: isoIn(PROPOSAL_TTL_MS),
    approval: "self",
    origin: "form",
    payload: { subscription_id: sub.id, target_offer_id: target.id },
    run_id: null,
  });
  db.proposals.push(proposal);
  return proposal;
}

export function createSupportCaseProposal(
  db: DemoDb,
  user: DemoUser,
  support: NonNullable<OwnedProposal["payload"]["support"]>,
  runId: string | null,
): OwnedProposal {
  const proposal = baseProposal(user, {
    type: "create_support_case",
    title: `Créer une demande d'assistance : ${support.subject}`,
    resource: { type: "support_case", id: "new", label: support.subject, version: 0 },
    consequences: [
      "Une demande d'assistance sera ouverte à votre nom avec le résumé ci-dessous.",
      `Résumé transmis : « ${support.body} »`,
      "L'équipe d'assistance pourra consulter les informations nécessaires à ce dossier uniquement.",
    ],
    amount: null,
    conditions_version: null,
    expires_at: isoIn(PROPOSAL_TTL_MS),
    approval: "self",
    origin: "assistant",
    payload: { support },
    run_id: runId,
  });
  db.proposals.push(proposal);
  return proposal;
}

export function createSupportCase(db: DemoDb, user: DemoUser, input: { category: SupportCase["category"]; subject: string; body: string; edition_id?: string | null; order_id?: string | null; subscription_id?: string | null }) {
  const now = clock.iso();
  db.counter += 1;
  const created = {
    id: nextId("case"),
    reference: `AS-${String(db.counter).padStart(4, "0")}`,
    owner: user.id,
    subject: input.subject,
    category: input.category,
    status: "open" as const,
    created_at: now,
    updated_at: now,
    requester: { id: user.id, label: user.display_name },
    assignee: null,
    related: { order_id: input.order_id ?? null, edition_id: input.edition_id ?? null, subscription_id: input.subscription_id ?? null },
    messages: [{ id: nextId("msg"), author: "reader" as const, author_label: user.display_name, body: input.body, at: now }],
  };
  db.cases.unshift(created);
  db.audit.unshift(auditEvent(now, actorOf(user), "support_case.create", { type: "support_case", id: created.id, label: created.reference }, null, "success"));
  return created;
}

/** Exécution d'une proposition confirmée, avec revalidation complète (SAFE03). */
export function executeProposal(db: DemoDb, user: DemoUser, proposal: OwnedProposal): OwnedProposal {
  const now = clock.iso();
  const stale = (message: string): never => {
    proposal.status = "superseded";
    return fail(409, "PROPOSAL_STALE", message);
  };
  switch (proposal.type) {
    case "purchase": {
      const offer = findOffer(db, proposal.payload.offer_id!);
      if (offer.version !== proposal.payload.offer_version) stale("Le prix ou les conditions de l'offre ont changé. Une nouvelle proposition est nécessaire.");
      const order = createOrderInternal(db, user, {
        offer_id: offer.id,
        offer_version: offer.version,
        accepted_conditions_version: offer.conditions_version,
      });
      proposal.result = {
        summary: `Commande ${order.reference} créée, en attente de paiement. Aucun paiement n'a été effectué.`,
        links: [{ label: "Procéder au paiement de test", to: `/commande/${order.id}` }],
      };
      break;
    }
    case "cancel_subscription": {
      const sub = db.subscriptions.find((s) => s.id === proposal.payload.subscription_id && s.user_id === user.id);
      if (!sub) return fail(404, "NOT_FOUND", "Abonnement introuvable.");
      if (sub.version !== proposal.resource.version || sub.status !== "active") stale("L'abonnement a changé depuis la préparation de cette proposition.");
      sub.status = "cancel_at_period_end";
      sub.version += 1;
      sub.history.push({ at: now, label: "Résiliation confirmée : l'accès reste ouvert jusqu'à la fin de la période." });
      proposal.result = {
        summary: `Résiliation enregistrée. Votre accès reste ouvert jusqu'au ${formatDateFor(user, sub.current_period_end)}.`,
        links: [{ label: "Voir l'abonnement", to: `/compte/abonnements/${sub.id}` }],
      };
      break;
    }
    case "change_plan": {
      const sub = db.subscriptions.find((s) => s.id === proposal.payload.subscription_id && s.user_id === user.id);
      if (!sub) return fail(404, "NOT_FOUND", "Abonnement introuvable.");
      const target = findOffer(db, proposal.payload.target_offer_id!);
      if (sub.version !== proposal.resource.version) stale("L'abonnement a changé depuis la préparation de cette proposition.");
      if (target.status !== "active") stale("La formule cible n'est plus disponible.");
      sub.scheduled_change = { target_offer_title: target.title, effective_at: sub.current_period_end };
      sub.version += 1;
      sub.history.push({ at: now, label: `Changement de formule programmé vers « ${target.title} » à l'échéance.` });
      proposal.result = {
        summary: `Changement programmé : « ${target.title} » à partir du ${formatDateFor(user, sub.current_period_end)}.`,
        links: [{ label: "Voir l'abonnement", to: `/compte/abonnements/${sub.id}` }],
      };
      break;
    }
    case "create_support_case": {
      const support = proposal.payload.support!;
      const created = createSupportCase(db, user, support);
      proposal.result = {
        summary: `Demande d'assistance ${created.reference} créée.`,
        links: [{ label: "Suivre la demande", to: `/compte/assistance/${created.id}` }],
      };
      break;
    }
    case "access_exception":
      return fail(403, "APPROVAL_REQUIRED", "Cette action exige l'approbation d'un responsable.");
  }
  proposal.status = "confirmed";
  db.audit.unshift(
    auditEvent(now, actorOf(user), `proposal.confirm.${proposal.type}`, { type: proposal.resource.type, id: proposal.resource.id, label: proposal.resource.label }, proposal.origin === "assistant" ? "Confirmée depuis l'assistant." : null, "success"),
  );
  return proposal;
}

export function toPublicProposal(p: OwnedProposal): ActionProposal {
  const { user_id: _u, payload: _p, run_id: _r, ...rest } = p;
  return structuredCloneSafe(rest);
}

/** Termine le run associé lorsque la proposition est décidée. */
export function closeRunForProposal(db: DemoDb, proposal: OwnedProposal): void {
  if (!proposal.run_id) return;
  const run = db.runs.find((r) => r.id === proposal.run_id);
  if (!run || run.status !== "waiting_approval") return;
  const pendingOthers = db.proposals.some((p) => p.run_id === run.id && p.status === "pending" && p.id !== proposal.id);
  if (pendingOthers) return;
  const seq = Math.max(...run.events.map((e) => e.seq)) + 1;
  run.events.push({ seq, run_id: run.id, at: clock.iso(), type: "status", status: "completed" });
}
