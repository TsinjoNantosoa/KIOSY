import { appConfig } from "@/config/app";
import type {
  AdminEditionRow,
  AgentRun,
  CatalogFacets,
  CatalogItem,
  CatalogPage,
  Edition,
  Message,
  Offer,
  Publication,
  RunEvent,
  Session,
  SupportCase,
  Universe,
} from "@/contracts/models";
import { EDITORIAL_TRANSITIONS, PROPOSAL_TTL_MS } from "@/contracts/rules";
import type { KiosyApi } from "@/services/api/types";
import { followEvents } from "@/services/runFollower";
import { normalize, planScenario, STEP_LABELS } from "./assistant";
import {
  ANONYMOUS_OWNER,
  clock,
  getDb,
  isoIn,
  nextId,
  saveDb,
  setDemoSessionUserId,
  type DemoDb,
  type DemoUser,
  type OwnedCase,
  type ScheduledRun,
} from "./db";
import { TERMS_DOCUMENTS, TERMS_VERSION } from "@/content/terms";
import { buildPdf } from "./pdf";
import { auditEvent, mga } from "./seed";
import {
  actorOf,
  closeRunForProposal,
  createCancellationProposal,
  createOrderInternal,
  createPlanChangeProposal,
  createSupportCase,
  currentUser,
  editionMarkdown,
  eligibility,
  executeProposal,
  fail,
  findOffer,
  hasRole,
  isPublic,
  libraryFor,
  publicationOf,
  readAccess,
  requireRole,
  requireUser,
  tick,
  toPublicOrder,
  toPublicProposal,
  withIdempotency,
} from "./server";

/** Latence simulée, annulable par AbortSignal (recherches obsolètes). */
function delay(signal?: AbortSignal): Promise<void> {
  const ms = appConfig.demoLatencyMs;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Enveloppe commune : latence, panne simulée, tâches planifiées, persistance. */
async function handle<T>(fn: (db: DemoDb) => T, signal?: AbortSignal, options: { ignoreOutage?: boolean } = {}): Promise<T> {
  await delay(signal);
  const db = getDb();
  if (db.flags.outage && !options.ignoreOutage) {
    fail(503, "SERVICE_UNAVAILABLE", "Le service est momentanément indisponible (panne simulée en mode démonstration).");
  }
  tick(db);
  try {
    return clone(fn(db));
  } finally {
    saveDb();
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function toSession(user: DemoUser): Session {
  const { demo_password: _p, ...publicUser } = user;
  return { user: publicUser, expires_at: isoIn(8 * 60 * 60 * 1000) };
}

const ANON_KEY = "kiosy-demo-anon";
function ownerId(db: DemoDb): string {
  const user = currentUser(db);
  if (user) return user.id;
  try {
    let anon = sessionStorage.getItem(ANON_KEY);
    if (!anon) {
      anon = `${ANONYMOUS_OWNER}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(ANON_KEY, anon);
    }
    return anon;
  } catch {
    return ANONYMOUS_OWNER;
  }
}

// ------------------------------------------------------------------ catalogue

function publishedEditions(db: DemoDb, publicationId: string): Edition[] {
  return db.editions
    .filter((e) => e.publication_id === publicationId && isPublic(e))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

function catalogItem(db: DemoDb, publication: Publication): CatalogItem | null {
  const editions = publishedEditions(db, publication.id);
  const latest = editions[0];
  if (!latest) return null;
  const prices = db.offers
    .filter((o) => o.kind === "single" && o.status === "active" && o.scope.kind === "edition" && editions.some((e) => e.id === (o.scope as { edition_id: string }).edition_id))
    .map((o) => o.price.amount);
  return {
    publication,
    latest_edition: latest,
    edition_count: editions.length,
    price_from: prices.length > 0 ? mga(Math.min(...prices)) : null,
    has_free_content: editions.some((e) => e.is_free),
    formats: [...new Set(editions.map((e) => e.format))],
  };
}

function relevance(item: CatalogItem, q: string): number {
  if (!q) return 0;
  const title = normalize(item.publication.title);
  let score = 0;
  if (title.includes(q)) score += 10;
  if (item.publication.tags.some((t) => normalize(t).includes(q))) score += 4;
  if (normalize(item.publication.summary).includes(q)) score += 2;
  return score;
}

function matchesQuery(item: CatalogItem, q: string): boolean {
  if (!q) return true;
  const haystack = normalize(
    [item.publication.title, item.publication.author, item.publication.summary, item.publication.publisher.name, ...item.publication.tags, item.latest_edition.label].join(" "),
  );
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

// ------------------------------------------------------------------ API

export function createDemoApi(): KiosyApi {
  return {
    legal: {
      async current(documentId) {
        return this.get(documentId, TERMS_VERSION);
      },
      async get(documentId, version) {
        await delay();
        const document = TERMS_DOCUMENTS.find((item) => item.slug === documentId);
        if (!document || version !== TERMS_VERSION) fail(404, "DOCUMENT_VERSION_NOT_FOUND", "Cette version du document n'existe pas.");
        return { document_id: documentId, version, title: document.title, effective_at: new Date(clock.now() - 30 * 86400000).toISOString(), source: "demo" as const, sections: document.sections };
      },
    },
    auth: {
      getSession: (opts) =>
        handle(
          (db) => {
            const user = currentUser(db);
            return user ? toSession(user) : null;
          },
          opts?.signal,
          { ignoreOutage: true },
        ),
      login: (input) =>
        handle((db) => {
          const user = db.users.find((u) => u.email.toLowerCase() === input.email.trim().toLowerCase());
          if (!user || user.demo_password !== input.password) fail(401, "INVALID_CREDENTIALS", "Adresse e-mail ou mot de passe incorrect.");
          setDemoSessionUserId(user.id);
          db.flags.session_expired = false;
          return toSession(user);
        }),
      register: (input) =>
        handle((db) => {
          const email = input.email.trim().toLowerCase();
          if (db.users.some((u) => u.email === email)) {
            fail(409, "EMAIL_TAKEN", "Un compte existe déjà avec cette adresse.", [{ field: "email", issue: "Adresse déjà utilisée." }]);
          }
          if (input.accepted_terms_version !== TERMS_VERSION) fail(409, "OFFER_CHANGED", "Les conditions ont changé : relisez-les avant de continuer.");
          const user: DemoUser = {
            id: nextId("u"),
            email,
            display_name: input.display_name.trim(),
            roles: ["reader"],
            publisher_id: null,
            preferences: { time_zone: appConfig.defaultTimeZone, language: "fr" },
            is_demo: true,
            demo_password: input.password,
          };
          db.users.push(user);
          setDemoSessionUserId(user.id);
          return toSession(user);
        }),
      logout: () => {
        // Effacement immédiat : une navigation juste après le clic ne doit pas laisser la session ouverte.
        setDemoSessionUserId(null);
        return handle(() => undefined, undefined, { ignoreOutage: true });
      },
      requestPasswordReset: () =>
        handle(() => {
          // Réponse identique que le compte existe ou non (pas d'énumération des comptes).
        }),
      resetPassword: (input) =>
        handle(() => {
          if (input.token !== "demo-reset-token") fail(400, "INVALID_TOKEN", "Ce lien de réinitialisation est invalide ou a expiré.");
        }),
      listSessions: (opts) =>
        handle((db) => {
          const user = requireUser(db);
          if (!db.sessions[user.id]) {
            db.sessions[user.id] = [
              { id: "sess_current", device_label: "Ce navigateur", created_at: isoIn(-3_600_000), last_seen_at: clock.iso(), current: true },
              { id: nextId("sess"), device_label: "Téléphone Android (fictif)", created_at: isoIn(-5 * 86_400_000), last_seen_at: isoIn(-86_400_000), current: false },
            ];
          }
          return db.sessions[user.id]!;
        }, opts?.signal),
      revokeSession: (id) =>
        handle((db) => {
          const user = requireUser(db);
          const list = db.sessions[user.id] ?? [];
          if (list.find((s) => s.id === id)?.current) fail(409, "INVALID_TRANSITION", "Utilisez la déconnexion pour fermer la session courante.");
          db.sessions[user.id] = list.filter((s) => s.id !== id);
        }),
      updatePreferences: (input) =>
        handle((db) => {
          const user = requireUser(db);
          if (input.time_zone) {
            if (!(appConfig.timeZones as readonly string[]).includes(input.time_zone)) fail(422, "VALIDATION_ERROR", "Fuseau horaire non pris en charge.");
            user.preferences.time_zone = input.time_zone;
          }
          if (input.display_name) user.display_name = input.display_name.trim();
          return toSession(user);
        }),
    },

    catalog: {
      search: (query, opts) =>
        handle((db) => {
          const q = normalize(query.q?.trim() ?? "");
          const pageSize = Math.min(Math.max(query.page_size ?? appConfig.catalog.pageSize, 1), 48);
          const all = db.publications.map((p) => catalogItem(db, p)).filter((x): x is CatalogItem => x !== null);
          const byQuery = all.filter((item) => matchesQuery(item, q));
          const facets: CatalogFacets = {
            universe: { presse: 0, business: 0, culture: 0 },
            language: {},
            format: { text: 0, pdf: 0 },
          };
          for (const item of byQuery) {
            facets.universe[item.publication.universe] += 1;
            facets.language[item.publication.language] = (facets.language[item.publication.language] ?? 0) + 1;
            for (const f of item.formats) facets.format[f] += 1;
          }
          const filtered = byQuery.filter(
            (item) =>
              (!query.universe || item.publication.universe === query.universe) &&
              (!query.language || item.publication.language === query.language) &&
              (!query.format || item.formats.includes(query.format)) &&
              (!query.price || (query.price === "free" ? item.has_free_content : item.price_from !== null)),
          );
          const sort = query.sort ?? (q ? "relevance" : "recent");
          const byRecent = (a: CatalogItem, b: CatalogItem) => Date.parse(b.latest_edition.published_at) - Date.parse(a.latest_edition.published_at);
          filtered.sort((a, b) => {
            let diff = 0;
            if (sort === "relevance") diff = relevance(b, q) - relevance(a, q) || byRecent(a, b);
            if (sort === "recent") diff = byRecent(a, b);
            if (sort === "title") diff = a.publication.title.localeCompare(b.publication.title, "fr");
            if (sort === "price_asc" || sort === "price_desc") {
              const pa = a.price_from?.amount ?? Number.POSITIVE_INFINITY;
              const pb = b.price_from?.amount ?? Number.POSITIVE_INFINITY;
              diff = pa === pb ? 0 : sort === "price_asc" ? pa - pb : pa === Infinity ? 1 : pb === Infinity ? -1 : pb - pa;
            }
            return diff || a.publication.id.localeCompare(b.publication.id); // tri stable
          });
          const page = Math.max(1, query.page ?? 1);
          const result: CatalogPage = {
            items: filtered.slice((page - 1) * pageSize, page * pageSize),
            page,
            page_size: pageSize,
            total: filtered.length,
            facets,
          };
          return result;
        }, opts?.signal),
      featured: (opts) =>
        handle((db) => {
          const items = db.publications.map((p) => catalogItem(db, p)).filter((x): x is CatalogItem => x !== null && x.latest_edition.availability.state === "available");
          items.sort((a, b) => Date.parse(b.latest_edition.published_at) - Date.parse(a.latest_edition.published_at));
          const picked: CatalogItem[] = [];
          for (const universe of ["presse", "business", "culture"] as Universe[]) picked.push(...items.filter((i) => i.publication.universe === universe).slice(0, 2));
          return picked;
        }, opts?.signal),
      getPublication: (idOrSlug, opts) =>
        handle((db) => {
          const publication = db.publications.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
          const editions = publication ? publishedEditions(db, publication.id) : [];
          if (!publication || editions.length === 0) fail(404, "NOT_FOUND", "Publication introuvable.");
          const editionIds = new Set(editions.map((e) => e.id));
          const offers = db.offers.filter(
            (o) =>
              o.status !== "retired" &&
              ((o.scope.kind === "edition" && editionIds.has(o.scope.edition_id)) ||
                (o.scope.kind === "collection" && o.scope.universe === publication.universe) ||
                (o.kind === "free" && editions.some((e) => e.is_free))),
          );
          return { publication, editions, offers };
        }, opts?.signal),
      getExcerpt: (editionId, opts) =>
        handle((db) => {
          const edition = db.editions.find((e) => e.id === editionId && isPublic(e));
          if (!edition) fail(404, "NOT_FOUND", "Édition introuvable.");
          if (!edition.permissions.public_excerpt) fail(403, "ACCESS_DENIED", "L'éditeur n'autorise pas d'extrait public pour cette édition.");
          const maxChars = 700;
          const full = editionMarkdown(db, edition);
          let excerpt = "";
          for (const paragraph of full.split("\n\n")) {
            if ((excerpt + paragraph).length > maxChars) break;
            excerpt += `${paragraph}\n\n`;
          }
          return {
            edition_id: edition.id,
            markdown: excerpt.trim(),
            truncated: excerpt.length < full.length,
            max_chars: maxChars,
            notice: "Extrait public autorisé par l'éditeur. Le fichier complet n'est pas exposé.",
          };
        }, opts?.signal),
    },

    offers: {
      list: (filter, opts) =>
        handle((db) => {
          if (!filter.publication_id) return db.offers.filter((o) => o.status !== "retired" && o.kind !== "single");
          const publication = db.publications.find((p) => p.id === filter.publication_id);
          if (!publication) fail(404, "NOT_FOUND", "Publication introuvable.");
          const ids = new Set(publishedEditions(db, publication.id).map((e) => e.id));
          return db.offers.filter((o) => o.status !== "retired" && ((o.scope.kind === "edition" && ids.has(o.scope.edition_id)) || (o.scope.kind === "collection" && o.scope.universe === publication.universe)));
        }, opts?.signal),
      get: (id, opts) =>
        handle((db) => {
          const offer = findOffer(db, id);
          if (offer.status === "retired") fail(404, "NOT_FOUND", "Offre introuvable.");
          return offer;
        }, opts?.signal),
    },

    me: {
      library: (opts) => handle((db) => libraryFor(db, requireUser(db).id), opts?.signal),
      access: (publicationId, opts) =>
        handle((db) => {
          const user = requireUser(db);
          const editions = publishedEditions(db, publicationId);
          const readable = editions.filter((e) => readAccess(db, user, e) !== null).map((e) => e.id);
          const entitlements = db.entitlements.filter(
            (e) => e.user_id === user.id && editions.some((ed) => (e.scope.kind === "edition" ? e.scope.edition_id === ed.id : publicationOf(db, ed).universe === e.scope.universe)),
          );
          return { publication_id: publicationId, readable_edition_ids: readable, entitlements };
        }, opts?.signal),
      eligibility: (offerIds, opts) =>
        handle((db) => {
          const user = currentUser(db);
          return offerIds.map((id) => eligibility(db, user, findOffer(db, id)));
        }, opts?.signal),
      assetAccess: (editionId, opts) =>
        handle((db) => {
          const edition = db.editions.find((e) => e.id === editionId);
          if (!edition || !isPublic(edition)) fail(404, "NOT_FOUND", "Contenu introuvable.");
          const user = edition.is_free ? currentUser(db) : requireUser(db);
          const access = readAccess(db, user, edition);
          if (!access) {
            const expired = user && db.entitlements.some((e) => e.user_id === user.id && e.status === "expired" && (e.scope.kind === "edition" ? e.scope.edition_id === edition.id : e.scope.universe === publicationOf(db, edition).universe));
            if (expired) fail(403, "ACCESS_EXPIRED", "Votre accès à ce contenu a expiré.");
            fail(403, "ACCESS_DENIED", "Ce contenu n'est pas inclus dans vos accès.");
          }
          const publication = publicationOf(db, edition);
          const markdown = editionMarkdown(db, edition);
          const mediaType = edition.format === "pdf" ? ("application/pdf" as const) : ("text/markdown" as const);
          const blob =
            edition.format === "pdf"
              ? new Blob([buildPdf(`${publication.title} - ${edition.label}`, markdown.replace(/^# .*\n/, ""), "Document de démonstration fictif")], { type: mediaType })
              : new Blob([markdown], { type: "text/markdown;charset=utf-8" });
          const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : `data:${mediaType},${encodeURIComponent(markdown)}`;
          db.audit.unshift(auditEvent(clock.iso(), user ? actorOf(user) : { id: "visitor", label: "Visiteur", role: "reader" }, "asset.access", { type: "edition", id: edition.id, label: `${publication.title}, ${edition.label}` }, null, "success"));
          return {
            asset_id: edition.asset_id ?? `asset_${edition.id}`,
            edition_id: edition.id,
            title: publication.title,
            edition_label: edition.label,
            publication_slug: publication.slug,
            format: edition.format,
            url,
            media_type: mediaType,
            expires_at: isoIn(5 * 60 * 1000),
            download_allowed: edition.format === "pdf" && publication.publisher.id === "pub_antsiva",
          };
        }, opts?.signal),
      orders: (opts) => handle((db) => db.orders.filter((o) => o.user_id === requireUser(db).id).map(toPublicOrder), opts?.signal),
      subscriptions: (opts) =>
        handle((db) => {
          const user = requireUser(db);
          return db.subscriptions.filter((s) => s.user_id === user.id).map(({ user_id: _u, version: _v, ...s }) => s);
        }, opts?.signal),
      subscription: (id, opts) =>
        handle((db) => {
          const user = requireUser(db);
          const sub = db.subscriptions.find((s) => s.id === id && s.user_id === user.id);
          if (!sub) fail(404, "NOT_FOUND", "Abonnement introuvable.");
          const { user_id: _u, version: _v, ...rest } = sub;
          return rest;
        }, opts?.signal),
    },

    commerce: {
      quote: (input, opts) =>
        handle((db) => {
          const user = currentUser(db);
          const offer = findOffer(db, input.offer_id);
          const renewalOf = input.renewal_of_subscription_id ?? null;
          const sub = renewalOf && user ? db.subscriptions.find((s) => s.id === renewalOf && s.user_id === user.id) : undefined;
          if (renewalOf && !sub) fail(404, "NOT_FOUND", "Abonnement introuvable.");
          const start = sub && Date.parse(sub.current_period_end) > clock.now() ? sub.current_period_end : clock.iso();
          const months = offer.duration ? (offer.duration.unit === "year" ? offer.duration.count * 12 : offer.duration.count) : 0;
          const end = offer.duration ? new Date(new Date(start).setUTCMonth(new Date(start).getUTCMonth() + months)).toISOString() : null;
          return {
            quote_id: nextId("quote"),
            offer,
            lines: [{ label: offer.title, amount: offer.price }],
            total: offer.price,
            access_starts_at: start,
            access_ends_at: end,
            eligibility: eligibility(db, user, offer, renewalOf),
            renewal_of_subscription_id: renewalOf,
            quote_expires_at: isoIn(PROPOSAL_TTL_MS),
          };
        }, opts?.signal),
      createOrder: (input, opts) =>
        handle((db) => {
          const user = requireUser(db);
          return withIdempotency(db, user.id, "create_order", opts.idempotencyKey, input, () => toPublicOrder(createOrderInternal(db, user, input)));
        }),
      getOrder: (id, opts) =>
        handle((db) => {
          const user = requireUser(db);
          const order = db.orders.find((o) => o.id === id && (o.user_id === user.id || hasRole(user, ["admin", "support", "manager"])));
          if (!order) fail(404, "NOT_FOUND", "Commande introuvable.");
          return toPublicOrder(order);
        }, opts?.signal),
      createCheckout: (orderId, opts) =>
        handle((db) => {
          const user = requireUser(db);
          return withIdempotency(db, user.id, `checkout:${orderId}`, opts.idempotencyKey, { orderId }, () => {
            const order = db.orders.find((o) => o.id === orderId && o.user_id === user.id);
            if (!order) fail(404, "NOT_FOUND", "Commande introuvable.");
            if (order.status === "fulfilled" || order.status === "paid") fail(409, "ORDER_ALREADY_PAID", "Cette commande est déjà réglée.");
            if (order.reservation?.status === "expired") fail(409, "RESERVATION_EXPIRED", "La réservation a expiré avant le paiement.");
            if (order.status !== "pending_payment") fail(409, "INVALID_TRANSITION", "Cette commande ne peut plus être payée.");
            if (order.payment?.status === "pending") {
              fail(409, "PAYMENT_PENDING", "Un paiement est en cours de vérification pour cette commande. Ne payez pas une seconde fois.");
            }
            const open = db.payment_sessions.find((s) => s.order_id === order.id && !s.outcome && Date.parse(s.expires_at) > clock.now());
            const session = open ?? { id: nextId("ps"), order_id: order.id, expires_at: isoIn(30 * 60 * 1000), outcome: null, deliver_at: null, delivered: false };
            if (!open) db.payment_sessions.push(session);
            order.payment = { status: "initiated", provider: "test", mode: "test", updated_at: clock.iso() };
            order.updated_at = clock.iso();
            return { session_id: session.id, order_id: order.id, redirect_url: `/paiement-test/${session.id}`, expires_at: session.expires_at, mode: "test" as const };
          });
        }),
    },

    proposals: {
      get: (id, opts) =>
        handle((db) => {
          const user = currentUser(db);
          const proposal = db.proposals.find((p) => p.id === id && user && (p.user_id === user.id || hasRole(user, ["manager", "admin"])));
          if (!proposal) fail(404, "NOT_FOUND", "Proposition introuvable.");
          return toPublicProposal(proposal);
        }, opts?.signal),
      confirm: (id, opts) =>
        handle((db) => {
          const user = requireUser(db);
          return withIdempotency(db, user.id, `confirm:${id}`, opts.idempotencyKey, { id }, () => {
            const proposal = db.proposals.find((p) => p.id === id && p.user_id === user.id);
            if (!proposal) fail(404, "NOT_FOUND", "Proposition introuvable.");
            if (proposal.approval === "manager") fail(403, "APPROVAL_REQUIRED", "Cette action exige l'approbation d'un responsable.");
            if (proposal.status === "expired") fail(409, "PROPOSAL_EXPIRED", "Cette proposition a expiré. Demandez une proposition actualisée.");
            if (proposal.status !== "pending") fail(409, "PROPOSAL_ALREADY_DECIDED", "Cette proposition a déjà été traitée.");
            executeProposal(db, user, proposal);
            closeRunForProposal(db, proposal);
            return toPublicProposal(proposal);
          });
        }),
      reject: (id, opts) =>
        handle((db) => {
          const user = requireUser(db);
          return withIdempotency(db, user.id, `reject:${id}`, opts.idempotencyKey, { id }, () => {
            const proposal = db.proposals.find((p) => p.id === id && p.user_id === user.id);
            if (!proposal) fail(404, "NOT_FOUND", "Proposition introuvable.");
            if (proposal.status === "pending") {
              proposal.status = "rejected";
              closeRunForProposal(db, proposal);
              db.audit.unshift(auditEvent(clock.iso(), actorOf(user), `proposal.reject.${proposal.type}`, { type: proposal.resource.type, id: proposal.resource.id, label: proposal.resource.label }, null, "success"));
            }
            return toPublicProposal(proposal);
          });
        }),
      prepareCancellation: (subId) =>
        handle((db) => {
          const user = requireUser(db);
          const sub = db.subscriptions.find((s) => s.id === subId && s.user_id === user.id);
          if (!sub) fail(404, "NOT_FOUND", "Abonnement introuvable.");
          return toPublicProposal(createCancellationProposal(db, user, sub, "form", null));
        }),
      preparePlanChange: (subId, targetId) =>
        handle((db) => {
          const user = requireUser(db);
          const sub = db.subscriptions.find((s) => s.id === subId && s.user_id === user.id);
          if (!sub) fail(404, "NOT_FOUND", "Abonnement introuvable.");
          return toPublicProposal(createPlanChangeProposal(db, user, sub, findOffer(db, targetId)));
        }),
    },

    assistant: {
      listConversations: (opts) =>
        handle((db) => {
          const owner = ownerId(db);
          return db.conversations
            .filter((c) => c.owner === owner)
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
            .map(({ owner: _o, ...c }) => c);
        }, opts?.signal),
      createConversation: () =>
        handle((db) => {
          const now = clock.iso();
          const conversation = { id: nextId("conv"), owner: ownerId(db), title: "Nouvelle conversation", created_at: now, updated_at: now, active_run_id: null, is_demo: true };
          db.conversations.push(conversation);
          const { owner: _o, ...rest } = conversation;
          return rest;
        }),
      getConversation: (id, opts) =>
        handle((db) => {
          const conversation = db.conversations.find((c) => c.id === id && c.owner === ownerId(db));
          if (!conversation) fail(404, "NOT_FOUND", "Conversation introuvable.");
          const { owner: _o, ...rest } = conversation;
          return rest;
        }, opts?.signal),
      listMessages: (id, opts) =>
        handle((db) => {
          const owner = ownerId(db);
          if (!db.conversations.some((c) => c.id === id && c.owner === owner)) fail(404, "NOT_FOUND", "Conversation introuvable.");
          const now = clock.now();
          return db.messages
            .filter((m) => m.conversation_id === id && Date.parse(m.visible_at) <= now)
            .map(({ owner: _o, visible_at: _v, ...m }): Message => m);
        }, opts?.signal),
      startRun: (conversationId, input, opts) =>
        handle((db) => {
          const owner = ownerId(db);
          const user = currentUser(db);
          const text = input.text.trim();
          if (!text) fail(422, "VALIDATION_ERROR", "Le message est vide.");
          if (text.length > appConfig.assistant.maxMessageLength) fail(422, "VALIDATION_ERROR", "Le message est trop long.");
          return withIdempotency(db, owner, `run:${conversationId}`, opts.idempotencyKey, input, () => {
            const conversation = db.conversations.find((c) => c.id === conversationId && c.owner === owner);
            if (!conversation) fail(404, "NOT_FOUND", "Conversation introuvable.");
            if (conversation.active_run_id) {
              const active = db.runs.find((r) => r.id === conversation.active_run_id);
              if (active && ["queued", "running"].includes(active.status)) fail(409, "RUN_IN_PROGRESS", "Une réponse est déjà en cours pour cette conversation.");
            }
            const now = clock.now();
            const runId = nextId("run");
            const userMessage = { id: nextId("msg"), conversation_id: conversationId, owner, role: "user" as const, created_at: new Date(now).toISOString(), visible_at: new Date(now).toISOString(), blocks: [{ type: "text" as const, markdown: text }], run_id: null };
            db.messages.push(userMessage);
            const plan = planScenario(db, user, text, runId);

            // Planification des événements : étapes séquentielles, recherches indépendantes en parallèle.
            const events: RunEvent[] = [];
            let seq = 0;
            const at = (offset: number) => new Date(now + offset).toISOString();
            events.push({ seq: ++seq, run_id: runId, at: at(0), type: "status", status: "queued" });
            events.push({ seq: ++seq, run_id: runId, at: at(250), type: "status", status: "running" });
            let cursor = 400;
            let lastStart = cursor;
            const timeline: { start: number; end: number; step: (typeof plan.steps)[number] }[] = [];
            for (const step of plan.steps) {
              const start = step.parallel ? lastStart : cursor;
              timeline.push({ start, end: start + step.durationMs, step });
              lastStart = start;
              cursor = Math.max(cursor, start + step.durationMs);
            }
            const stepEvents: { offset: number; event: Omit<Extract<RunEvent, { type: "step" }>, "seq"> }[] = [];
            for (const { start, end, step } of timeline) {
              const label = STEP_LABELS[step.key];
              stepEvents.push({ offset: start, event: { run_id: runId, at: at(start), type: "step", step: { key: step.key, label, state: "running" } } });
              stepEvents.push({ offset: end, event: { run_id: runId, at: at(end), type: "step", step: { key: step.key, label, state: step.status === "failed" ? "failed" : "done" } } });
            }
            stepEvents.sort((a, b) => a.offset - b.offset);
            for (const { event } of stepEvents) events.push({ ...event, seq: ++seq });
            const doneAt = cursor + 300;
            const messageId = nextId("msg");
            db.messages.push({ id: messageId, conversation_id: conversationId, owner, role: "assistant", created_at: at(doneAt), visible_at: at(doneAt), blocks: plan.blocks, run_id: runId });
            if (plan.error) events.push({ seq: ++seq, run_id: runId, at: at(doneAt), type: "error", code: plan.error.code, message: plan.error.message });
            events.push({ seq: ++seq, run_id: runId, at: at(doneAt), type: "message", message_id: messageId });
            events.push({ seq: ++seq, run_id: runId, at: at(doneAt + 50), type: "status", status: plan.finalStatus });

            const run: ScheduledRun = {
              id: runId,
              conversation_id: conversationId,
              owner,
              status: "queued",
              created_at: at(0),
              updated_at: at(0),
              last_seq: 0,
              steps: [],
              error: null,
              events,
              cancelled_at: null,
              diagnostic: {
                actor_label: user?.display_name ?? "Visiteur",
                request_summary: plan.requestSummary,
                model: "simulation-démo (aucun modèle appelé)",
                prompt_version: "coordinateur@démo-0.1",
                tokens: null,
                cost: { amount_usd: null, kind: "unavailable", tariff_version: null },
                is_simulated: true,
                steps: [
                  { id: nextId("st"), agent: "coordinateur", tool: null, mcp_server: null, started_at: at(250), duration_ms: 150, status: "ok", error_code: null, summary: plan.steps.length ? `Délégation à ${[...new Set(plan.steps.map((s) => s.agent))].join(", ")}.` : "Réponse directe sans délégation.", evidence_refs: [] },
                  ...timeline.map(({ start, step }) => ({
                    id: nextId("st"),
                    agent: step.agent,
                    tool: step.tool,
                    mcp_server: step.server,
                    started_at: at(start),
                    duration_ms: step.durationMs,
                    status: step.status,
                    error_code: step.errorCode ?? null,
                    summary: step.summary,
                    evidence_refs: step.evidence,
                  })),
                ],
              },
            };
            db.runs.push(run);
            conversation.active_run_id = runId;
            conversation.updated_at = at(0);
            if (conversation.title === "Nouvelle conversation") conversation.title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
            const { owner: _o, visible_at: _v, ...publicMessage } = userMessage;
            return { run_id: runId, status: "queued" as const, status_url: `/v1/runs/${runId}`, user_message: publicMessage };
          });
        }),
      getRun: (id, opts) => handle((db) => publicRun(db, id), opts?.signal),
      listRunEvents: (id, afterSeq, opts) => handle((db) => visibleEvents(db, id, afterSeq), opts?.signal),
      followRun(runId, afterSeq, handlers) {
        // Simule un flux SSE en lisant les événements devenus visibles.
        const stream = {
          open(after: number, onEvent: (e: RunEvent) => void, onError: () => void, onOpen: () => void) {
            onOpen();
            let last = after;
            const timer = setInterval(() => {
              try {
                const db = getDb();
                if (db.flags.outage) {
                  onError();
                  return;
                }
                tick(db);
                for (const event of visibleEvents(db, runId, last)) {
                  last = event.seq;
                  onEvent(clone(event));
                }
              } catch {
                onError();
              }
            }, 150);
            return () => clearInterval(timer);
          },
        };
        return followEvents({
          afterSeq,
          stream,
          poll: (after) => handle((db) => visibleEvents(db, runId, after)),
          onEvent: handlers.onEvent,
          onConnectionChange: handlers.onConnectionChange,
          pollIntervalMs: appConfig.assistant.pollIntervalMs,
          retryDelayMs: appConfig.assistant.sseRetryDelayMs,
        });
      },
      cancelRun: (id) =>
        handle((db) => {
          const run = db.runs.find((r) => r.id === id && r.owner === ownerId(db));
          if (!run) fail(404, "NOT_FOUND", "Traitement introuvable.");
          if (["queued", "running"].includes(run.status)) {
            const now = clock.now();
            const future = new Set(run.events.filter((e) => Date.parse(e.at) > now).map((e) => (e.type === "message" ? e.message_id : "")));
            run.events = run.events.filter((e) => Date.parse(e.at) <= now);
            db.messages = db.messages.filter((m) => !future.has(m.id));
            // Les propositions préparées mais jamais montrées sont retirées ; rien d'exécuté n'est annulé.
            for (const p of db.proposals) if (p.run_id === run.id && p.status === "pending") p.status = "superseded";
            const seq = Math.max(0, ...run.events.map((e) => e.seq)) + 1;
            run.events.push({ seq, run_id: run.id, at: clock.iso(), type: "status", status: "cancelled" });
            run.cancelled_at = clock.iso();
            tick(db);
          }
          return publicRun(db, id);
        }),
      sendFeedback: (messageId, input) =>
        handle(() => ({ message_id: messageId, rating: input.rating, reason: input.reason ?? null })),
    },

    support: {
      list: (opts) => handle((db) => db.cases.filter((c) => c.owner === requireUser(db).id).map(publicCase), opts?.signal),
      get: (id, opts) =>
        handle((db) => {
          const user = requireUser(db);
          const found = db.cases.find((c) => c.id === id && c.owner === user.id);
          if (!found) fail(404, "NOT_FOUND", "Demande introuvable.");
          return publicCase(found);
        }, opts?.signal),
      create: (input, opts) =>
        handle((db) => {
          const user = requireUser(db);
          if (input.subject.trim().length < 5 || input.body.trim().length < 10) fail(422, "VALIDATION_ERROR", "Objet ou description trop court.");
          return withIdempotency(db, user.id, "support_case", opts.idempotencyKey, input, () => publicCase(createSupportCase(db, user, input)));
        }),
      reply: (id, body, opts) =>
        handle((db) => {
          const user = requireUser(db);
          return withIdempotency(db, user.id, `reply:${id}`, opts.idempotencyKey, { body }, () => {
            const found = db.cases.find((c) => c.id === id && c.owner === user.id);
            if (!found) fail(404, "NOT_FOUND", "Demande introuvable.");
            if (found.status === "closed") fail(409, "INVALID_TRANSITION", "Cette demande est clôturée.");
            found.messages.push({ id: nextId("msg"), author: "reader", author_label: user.display_name, body, at: clock.iso() });
            if (found.status === "waiting_reader" || found.status === "resolved") found.status = "open";
            found.updated_at = clock.iso();
            return publicCase(found);
          });
        }),
    },

    admin: {
      ops: (opts) =>
        handle((db) => {
          requireRole(db, ["admin", "manager", "support"]);
          return {
            generated_at: clock.iso(),
            is_demo: true,
            counts: {
              publications_in_review: db.editions.filter((e) => e.status === "review").length,
              imports_failed: db.imports.filter((i) => i.status === "failed").length,
              orders_pending_payment: db.orders.filter((o) => o.status === "pending_payment").length,
              payment_exceptions: db.orders.filter((o) => o.status === "payment_exception").length,
              tickets_open: db.cases.filter((c) => ["open", "in_progress", "waiting_reader"].includes(c.status)).length,
              approvals_pending: db.approvals.filter((a) => a.status === "pending").length,
              runs_failed: db.runs.filter((r) => r.status === "failed").length,
              proposals_expired: db.proposals.filter((p) => p.status === "expired").length,
            },
          };
        }, opts?.signal),
      publishers: (opts) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          return user.roles.includes("admin") ? db.publishers : db.publishers.filter((p) => p.id === user.publisher_id);
        }, opts?.signal),
      editions: (filter, opts) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          const q = normalize(filter.q ?? "");
          return db.editions
            .filter((e) => !filter.status || e.status === filter.status)
            .map((edition) => ({ edition, publication: publicationOf(db, edition) }))
            .filter((row) => (user.roles.includes("admin") || row.publication.publisher.id === user.publisher_id) && (!q || normalize(`${row.publication.title} ${row.edition.label}`).includes(q)))
            .sort((a, b) => Date.parse(b.edition.published_at) - Date.parse(a.edition.published_at));
        }, opts?.signal),
      edition: (id, opts) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          const edition = db.editions.find((e) => e.id === id);
          if (!edition) fail(404, "NOT_FOUND", "Édition introuvable.");
          const publication = publicationOf(db, edition);
          if (!user.roles.includes("admin") && publication.publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Édition introuvable.");
          return { edition, publication };
        }, opts?.signal),
      createPublication: (input) =>
        handle((db): AdminEditionRow => {
          const user = requireRole(db, ["admin", "publisher"]);
          const publisher = db.publishers.find((p) => p.id === input.publisher_id);
          if (!publisher) fail(422, "VALIDATION_ERROR", "Éditeur inconnu.", [{ field: "publisher_id", issue: "Éditeur inconnu." }]);
          if (!user.roles.includes("admin") && publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Éditeur introuvable.");
          const id = nextId("p");
          const slugBase = normalize(input.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const publication: Publication = {
            id,
            slug: db.publications.some((p) => p.slug === slugBase) ? `${slugBase}-${id}` : slugBase,
            title: input.title.trim(),
            author: input.author.trim(),
            publisher,
            universe: input.universe,
            language: input.language,
            summary: input.summary.trim(),
            tags: input.tags,
            cover: { palette: ["#F4EFE3", "#1B2230", "#1F5D4C"], motif: "grid", kicker: "Nouveau" },
            kind: "series",
            is_demo: true,
          };
          const edition: Edition = {
            id: nextId("e"),
            publication_id: id,
            label: input.edition.label.trim(),
            published_at: input.edition.published_at,
            format: input.edition.format,
            language: input.language,
            page_count: null,
            word_count: null,
            status: "draft",
            availability: { state: "available", territories: ["MG"], rights_valid_until: null, reason: null },
            permissions: input.edition.permissions,
            is_free: input.edition.is_free,
            version: 1,
            asset_id: null,
          };
          db.publications.push(publication);
          db.editions.push(edition);
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "publication.create", { type: "publication", id, label: publication.title }, null, "success"));
          return { edition, publication };
        }),
      createEdition: (publicationId, input) =>
        handle((db): AdminEditionRow => {
          const user = requireRole(db, ["admin", "publisher"]);
          const publication = db.publications.find((p) => p.id === publicationId);
          if (!publication) fail(404, "NOT_FOUND", "Publication introuvable.");
          if (!user.roles.includes("admin") && publication.publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Publication introuvable.");
          const edition: Edition = {
            id: nextId("e"), publication_id: publication.id, label: input.label.trim(), published_at: input.published_at,
            format: input.format, language: publication.language, page_count: null, word_count: null, status: "draft",
            availability: { state: "available", territories: ["MG"], rights_valid_until: null, reason: null },
            permissions: input.permissions, is_free: input.is_free, version: 1, asset_id: null,
          };
          db.editions.push(edition);
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "edition.create", { type: "edition", id: edition.id, label: `${publication.title} — ${edition.label}` }, null, "success"));
          return { edition, publication };
        }),
      updatePublication: (id, input) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          const publication = db.publications.find((p) => p.id === id);
          if (!publication) fail(404, "NOT_FOUND", "Publication introuvable.");
          if (!user.roles.includes("admin") && publication.publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Publication introuvable.");
          const publisher = db.publishers.find((p) => p.id === input.publisher_id);
          if (!publisher) fail(422, "VALIDATION_ERROR", "Éditeur inconnu.");
          Object.assign(publication, { title: input.title.trim(), author: input.author.trim(), universe: input.universe, language: input.language, summary: input.summary.trim(), tags: input.tags, publisher });
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "publication.update", { type: "publication", id, label: publication.title }, null, "success"));
          return publication;
        }),
      updateEdition: (id, input) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          const edition = db.editions.find((e) => e.id === id);
          if (!edition) fail(404, "NOT_FOUND", "Édition introuvable.");
          const publication = publicationOf(db, edition);
          if (!user.roles.includes("admin") && publication.publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Édition introuvable.");
          if (edition.version !== input.version) fail(409, "VERSION_CONFLICT", "Cette édition a été modifiée entre-temps. Rechargez-la avant d'enregistrer.");
          Object.assign(edition, { label: input.label.trim(), format: input.format, published_at: input.published_at, permissions: input.permissions, is_free: input.is_free, version: edition.version + 1 });
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "edition.update", { type: "edition", id, label: edition.label }, null, "success"));
          return { edition, publication };
        }),
      transitionEdition: (id, input) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          const edition = db.editions.find((e) => e.id === id);
          if (!edition) fail(404, "NOT_FOUND", "Édition introuvable.");
          const publication = publicationOf(db, edition);
          if (!user.roles.includes("admin") && publication.publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Édition introuvable.");
          if (!user.roles.includes("admin") && input.to !== "review") fail(409, "INVALID_TRANSITION", "Seule l'administration peut prendre cette décision.");
          if (edition.version !== input.version) fail(409, "VERSION_CONFLICT", "Cette édition a été modifiée entre-temps. Rechargez-la.");
          if (!EDITORIAL_TRANSITIONS[edition.status].includes(input.to)) {
            db.audit.unshift(auditEvent(clock.iso(), actorOf(user), `edition.${input.to}`, { type: "edition", id, label: edition.label }, `Transition refusée ${edition.status} → ${input.to}.`, "denied"));
            fail(409, "INVALID_TRANSITION", `Transition non autorisée : ${edition.status} → ${input.to}.`);
          }
          if ((input.to === "review" || input.to === "published") && !edition.asset_id) fail(409, "ASSET_NOT_READY", "Aucun fichier traité avec succès pour cette édition : importez-le avant de continuer.");
          if ((input.to === "suspended" || input.to === "archived") && input.reason.trim().length < 5) fail(422, "VALIDATION_ERROR", "Un motif est requis pour un retrait.");
          edition.status = input.to;
          edition.version += 1;
          // Retrait : blocage des nouvelles ventes (CAT07). Publication : réactivation.
          for (const offer of db.offers) {
            if (offer.scope.kind === "edition" && offer.scope.edition_id === edition.id && offer.status !== "unavailable") {
              offer.status = input.to === "published" ? "active" : "retired";
            }
          }
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), `edition.${input.to}`, { type: "edition", id, label: edition.label }, input.reason || null, "success"));
          return { edition, publication };
        }),
      offers: (opts) =>
        handle((db) => {
          requireRole(db, ["admin"]);
          return db.offers;
        }, opts?.signal),
      createOffer: (input) =>
        handle((db): Offer => {
          const user = requireRole(db, ["admin"]);
          if (input.kind === "free" && input.price.amount !== 0) fail(422, "VALIDATION_ERROR", "Une offre gratuite doit avoir un montant nul.");
          if (input.kind === "subscription" && input.scope.kind !== "collection") fail(422, "VALIDATION_ERROR", "Un abonnement doit viser une collection.");
          if (input.kind === "single" && input.scope.kind !== "edition") fail(422, "VALIDATION_ERROR", "Un achat unitaire doit viser une édition.");
          if (input.quota_total !== null && (!Number.isInteger(input.quota_total) || input.quota_total <= 0)) fail(422, "VALIDATION_ERROR", "Le quota doit être un entier positif.");
          const offer: Offer = {
            id: nextId("off"), version: 1, kind: input.kind, title: input.title.trim(), description: input.description.trim(),
            price: input.price, duration: input.duration, renewal: input.kind === "subscription" ? "manual" : "none",
            scope: input.scope, restrictions: input.restrictions, conditions_version: input.conditions_version,
            status: input.status, status_reason: input.status === "unavailable" ? "Offre créée indisponible." : null,
            quota: input.quota_total === null ? null : { total: input.quota_total, remaining: input.quota_total }, is_demo: true,
          };
          db.offers.push(offer);
          db.offer_history[offer.id] = [clone(offer)];
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "offer.create", { type: "offer", id: offer.id, label: offer.title }, null, "success"));
          return offer;
        }),
      offerVersions: (id, opts) =>
        handle((db) => {
          requireRole(db, ["admin"]);
          return [...(db.offer_history[id] ?? [])].reverse();
        }, opts?.signal),
      updateOffer: (id, input) =>
        handle((db): Offer => {
          const user = requireRole(db, ["admin"]);
          const offer = findOffer(db, id);
          if (offer.version !== input.version) fail(409, "VERSION_CONFLICT", "L'offre a été modifiée entre-temps. Rechargez-la.");
          if (!Number.isInteger(input.price_amount) || input.price_amount < 0) fail(422, "VALIDATION_ERROR", "Le prix doit être un entier positif.", [{ field: "price_amount", issue: "Entier positif attendu." }]);
          if (offer.kind === "free" && input.price_amount !== 0) fail(422, "VALIDATION_ERROR", "Une offre gratuite reste à 0.");
          Object.assign(offer, {
            title: input.title.trim(),
            description: input.description.trim(),
            price: { ...offer.price, amount: input.price_amount },
            restrictions: input.restrictions,
            status: input.status,
            status_reason: input.status === "unavailable" ? "Rendue indisponible par l'administration." : null,
            version: offer.version + 1,
          });
          (db.offer_history[id] ??= []).push(clone(offer));
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "offer.new_version", { type: "offer", id, label: `${offer.title} v${offer.version}` }, null, "success"));
          return offer;
        }),
      imports: (opts) =>
        handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          return db.imports
            .filter((job) => user.roles.includes("admin") || publicationOf(db, db.editions.find((e) => e.id === job.edition_id)!).publisher.id === user.publisher_id)
            .map(({ schedule: _s, final_error: _f, ...job }) => job)
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        }, opts?.signal),
      publisherReviews: (opts) =>
        handle((db) => {
          const user = requireRole(db, ["publisher"]);
          return db.editions
            .filter((edition) => edition.status === "changes_requested")
            .map((edition) => ({ edition, publication: publicationOf(db, edition) }))
            .filter(({ publication }) => publication.publisher.id === user.publisher_id)
            .map(({ edition, publication }) => ({
              id: `review-${edition.id}`,
              edition_id: edition.id,
              edition_label: edition.label,
              publication_title: publication.title,
              decision: "changes_requested" as const,
              comment: "Des modifications ont été demandées avant publication.",
              created_at: edition.published_at,
            }));
        }, opts?.signal),
      publisherAnalytics: (opts) =>
        handle((db) => {
          const user = requireRole(db, ["publisher"]);
          const publications = db.publications.filter((publication) => publication.publisher.id === user.publisher_id);
          const publicationIds = new Set(publications.map((publication) => publication.id));
          const editions = db.editions.filter((edition) => publicationIds.has(edition.publication_id));
          const editionIds = new Set(editions.map((edition) => edition.id));
          return {
            publications: publications.length,
            editions: editions.length,
            orders: db.orders.filter((order) => order.edition_id && editionIds.has(order.edition_id)).length,
            entitlements: db.entitlements.filter((right) => right.scope.kind === "edition" && editionIds.has(right.scope.edition_id)).length,
          };
        }, opts?.signal),
      uploadImport: async (input, opts) => {
        const head = await input.file.slice(0, 5).text().catch(() => "");
        return handle((db) => {
          const user = requireRole(db, ["admin", "publisher"]);
          return withIdempotency(db, user.id, "import", opts.idempotencyKey, { name: input.file.name, size: input.file.size, edition: input.edition_id }, () => {
            const edition = db.editions.find((e) => e.id === input.edition_id);
            if (!edition) fail(422, "VALIDATION_ERROR", "Édition inconnue.", [{ field: "edition_id", issue: "Édition inconnue." }]);
            if (!user.roles.includes("admin") && publicationOf(db, edition).publisher.id !== user.publisher_id) fail(404, "NOT_FOUND", "Édition introuvable.");
            const name = input.file.name.toLowerCase();
            if (input.file.size > appConfig.upload.maxBytes) fail(422, "VALIDATION_ERROR", "Fichier trop volumineux.");
            if (!appConfig.upload.acceptedExtensions.some((ext) => name.endsWith(ext))) fail(422, "VALIDATION_ERROR", "Extension non autorisée.");
            if (name.endsWith(".pdf") && head !== "%PDF-") fail(422, "VALIDATION_ERROR", "Le contenu du fichier ne correspond pas à un PDF (type réel incohérent).");
            if (name.includes("/") || name.includes("\\") || name.includes("..")) fail(422, "VALIDATION_ERROR", "Nom de fichier invalide.");
            const willFail = name.includes("scan");
            const t = (s: number) => isoIn(s * 1000);
            const schedule = [
              { status: "quarantined" as const, at: t(1), progress: 15 },
              { status: "validating" as const, at: t(3), progress: 35 },
              { status: "extracting" as const, at: t(5), progress: 60 },
              willFail ? { status: "failed" as const, at: t(7), progress: 60 } : { status: "indexing" as const, at: t(7), progress: 85 },
              ...(willFail ? [] : [{ status: "ready" as const, at: t(9), progress: 100 }]),
            ];
            const job = {
              id: nextId("imp"),
              file_name: input.file.name,
              size_bytes: input.file.size,
              media_type: input.file.type || "application/octet-stream",
              edition_id: edition.id,
              edition_label: `${publicationOf(db, edition).title}, ${edition.label}`,
              status: "uploaded" as const,
              progress: 5,
              error: null,
              warnings: [],
              created_at: clock.iso(),
              updated_at: clock.iso(),
              schedule,
              final_error: willFail ? { code: "NO_EXTRACTABLE_TEXT", message: "Aucun texte extractible : document numérisé. L'OCR n'est pas disponible au MVP." } : null,
            };
            db.imports.unshift(job);
            db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "import.upload", { type: "import", id: job.id, label: job.file_name }, null, "success"));
            const { schedule: _s, final_error: _f, ...publicJob } = job;
            return publicJob;
          });
        });
      },
      orders: (filter, opts) =>
        handle((db) => {
          requireRole(db, ["admin", "support", "manager"]);
          return db.orders
            .filter((o) => !filter.status || o.status === filter.status)
            .map((o) => {
              const customer = db.users.find((u) => u.id === o.user_id)!;
              return { ...toPublicOrder(o), customer: { id: customer.id, display_name: customer.display_name, email: customer.email } };
            });
        }, opts?.signal),
      reconcilePayment: (orderId) =>
        handle((db) => {
          const user = requireRole(db, ["admin"]);
          const order = db.orders.find((o) => o.id === orderId);
          if (!order) fail(404, "NOT_FOUND", "Commande introuvable.");
          const session = db.payment_sessions.find((s) => s.order_id === orderId && !s.delivered && s.outcome);
          if (session) {
            // Réconciliation : on interroge le prestataire (simulé) avec la même référence (PAY06).
            const truth = session.outcome === "no_response" ? "succeeded" : session.outcome!;
            session.outcome = truth;
            session.deliver_at = clock.iso();
            tick(db);
          }
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "payment.reconcile", { type: "order", id: order.id, label: order.reference }, session ? "Statut relu auprès du prestataire de test." : "Aucun paiement en attente à réconcilier.", "success"));
          return toPublicOrder(order);
        }),
      subscriptions: (opts) =>
        handle((db) => {
          requireRole(db, ["admin", "support", "manager"]);
          return db.subscriptions.map(({ user_id, version: _v, ...s }) => {
            const customer = db.users.find((u) => u.id === user_id)!;
            return { ...s, customer: { id: customer.id, display_name: customer.display_name, email: customer.email } };
          });
        }, opts?.signal),
      users: (opts) =>
        handle((db) => {
          requireRole(db, ["admin", "support", "manager"]);
          return db.users.filter((u) => u.roles.includes("reader")).map((u) => ({ id: u.id, display_name: u.display_name, email: u.email }));
        }, opts?.signal),
      entitlements: (userId, opts) =>
        handle((db) => {
          requireRole(db, ["admin", "support", "manager"]);
          return db.entitlements.filter((e) => e.user_id === userId);
        }, opts?.signal),
      supportCases: (filter, opts) =>
        handle((db) => {
          requireRole(db, ["support", "manager", "admin"]);
          return db.cases.filter((c) => !filter.status || c.status === filter.status).map(publicCase);
        }, opts?.signal),
      supportCase: (id, opts) =>
        handle((db) => {
          requireRole(db, ["support", "manager", "admin"]);
          const found = db.cases.find((c) => c.id === id);
          if (!found) fail(404, "NOT_FOUND", "Demande introuvable.");
          return publicCase(found);
        }, opts?.signal),
      replySupportCase: (id, input, opts) =>
        handle((db) => {
          const user = requireRole(db, ["support", "manager", "admin"]);
          return withIdempotency(db, user.id, `staff_reply:${id}`, opts.idempotencyKey, input, () => {
            const found = db.cases.find((c) => c.id === id);
            if (!found) fail(404, "NOT_FOUND", "Demande introuvable.");
            if (input.body.trim()) found.messages.push({ id: nextId("msg"), author: "support", author_label: user.display_name, body: input.body.trim(), at: clock.iso() });
            found.status = input.status;
            found.assignee ??= { id: user.id, label: user.display_name };
            found.updated_at = clock.iso();
            db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "support_case.reply", { type: "support_case", id, label: found.reference }, `Statut : ${input.status}.`, "success"));
            return publicCase(found);
          });
        }),
      requestAccessException: (caseId, input) =>
        handle((db) => {
          const user = requireRole(db, ["support", "manager", "admin"]);
          const found = db.cases.find((c) => c.id === caseId);
          if (!found) fail(404, "NOT_FOUND", "Demande introuvable.");
          if (input.reason.trim().length < 10) fail(422, "VALIDATION_ERROR", "Un motif détaillé est requis.", [{ field: "reason", issue: "10 caractères minimum." }]);
          if (input.days < 1 || input.days > 30) fail(422, "VALIDATION_ERROR", "Durée entre 1 et 30 jours.");
          const edition = db.editions.find((e) => e.id === input.edition_id);
          if (!edition) fail(422, "VALIDATION_ERROR", "Édition inconnue.");
          const beneficiary = db.users.find((u) => u.id === found.owner)!;
          const label = `${publicationOf(db, edition).title}, ${edition.label}`;
          const proposal = {
            id: nextId("prop"),
            user_id: user.id,
            type: "access_exception" as const,
            status: "pending" as const,
            title: `Accès exceptionnel de ${input.days} jours : ${label}`,
            resource: { type: "edition", id: edition.id, label, version: edition.version },
            consequences: [`${beneficiary.display_name} obtient un accès de lecture de ${input.days} jours à cette édition.`, "L'attribution est tracée dans l'audit avec le motif et l'approbateur."],
            amount: null,
            conditions_version: null,
            expires_at: isoIn(2 * 86_400_000),
            approval: "manager" as const,
            origin: "form" as const,
            created_at: clock.iso(),
            result: null,
            payload: { edition_id: edition.id, days: input.days, beneficiary_id: beneficiary.id },
            run_id: null,
          };
          db.proposals.push(proposal);
          const approval = { id: nextId("appr"), proposal: toPublicProposal(proposal), requested_by: { id: user.id, label: user.display_name }, reason: input.reason.trim(), status: "pending" as const, decided_by: null, decided_at: null, case_id: caseId };
          db.approvals.unshift(approval);
          db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "approval.request", { type: "edition", id: edition.id, label }, input.reason.trim(), "success"));
          return approval;
        }),
      approvals: (opts) =>
        handle((db) => {
          const user = requireRole(db, ["support", "manager", "admin"]);
          tick(db);
          for (const a of db.approvals) {
            const p = db.proposals.find((x) => x.id === a.proposal.id);
            if (p) a.proposal = toPublicProposal(p);
          }
          return hasRole(user, ["manager", "admin"]) ? db.approvals : db.approvals.filter((a) => a.requested_by.id === user.id);
        }, opts?.signal),
      decideApproval: (id, input, opts) =>
        handle((db) => {
          const user = requireRole(db, ["manager"]);
          return withIdempotency(db, user.id, `decide:${id}`, opts.idempotencyKey, input, () => {
            const approval = db.approvals.find((a) => a.id === id);
            if (!approval) fail(404, "NOT_FOUND", "Demande d'approbation introuvable.");
            const proposal = db.proposals.find((p) => p.id === approval.proposal.id)!;
            if (approval.requested_by.id === user.id) {
              db.audit.unshift(auditEvent(clock.iso(), actorOf(user), "approval.decide", { type: "approval", id, label: proposal.title }, "Le demandeur ne peut pas approuver sa propre demande.", "denied"));
              fail(403, "SELF_APPROVAL_FORBIDDEN", "Vous ne pouvez pas approuver une demande que vous avez vous-même formulée.");
            }
            if (approval.status !== "pending") fail(409, "PROPOSAL_ALREADY_DECIDED", "Cette demande a déjà été traitée.");
            if (proposal.status === "expired" || Date.parse(proposal.expires_at) <= clock.now()) fail(409, "PROPOSAL_EXPIRED", "Cette demande a expiré.");
            if (input.reason.trim().length < 5) fail(422, "VALIDATION_ERROR", "Un motif de décision est requis.");
            const now = clock.iso();
            if (input.decision === "approve") {
              const days = proposal.payload.days ?? 7;
              db.entitlements.push({ id: nextId("ent"), user_id: proposal.payload.beneficiary_id!, source: "admin_grant", source_ref: approval.id, scope: { kind: "edition", edition_id: proposal.payload.edition_id! }, valid_from: now, valid_until: isoIn(days * 86_400_000), status: "active" });
              proposal.status = "confirmed";
              proposal.result = { summary: `Accès accordé pour ${days} jours.`, links: [] };
            } else {
              proposal.status = "rejected";
            }
            approval.status = input.decision === "approve" ? "approved" : "rejected";
            approval.decided_by = { id: user.id, label: user.display_name };
            approval.decided_at = now;
            approval.proposal = toPublicProposal(proposal);
            db.audit.unshift(auditEvent(now, actorOf(user), `approval.${approval.status}`, { type: "approval", id, label: proposal.title }, input.reason.trim(), "success"));
            return approval;
          });
        }),
      audit: (filter, opts) =>
        handle((db) => {
          requireRole(db, ["admin", "manager"]);
          const q = normalize(filter.q ?? "");
          const items = db.audit.filter(
            (e) => (!filter.result || e.result === filter.result) && (!q || normalize(`${e.action} ${e.actor.label} ${e.target.label} ${e.reason ?? ""}`).includes(q)),
          );
          return { items: items.slice(0, 100), page: 1, page_size: 100, total: items.length };
        }, opts?.signal),
      runs: (opts) =>
        handle((db) => {
          requireRole(db, ["admin"]);
          return db.runs
            .map((r) => ({ run: publicRun(db, r.id), ...r.diagnostic }))
            .sort((a, b) => Date.parse(b.run.created_at) - Date.parse(a.run.created_at));
        }, opts?.signal),
      run: (id, opts) =>
        handle((db) => {
          requireRole(db, ["admin"]);
          const run = db.runs.find((r) => r.id === id);
          if (!run) fail(404, "NOT_FOUND", "Traitement introuvable.");
          return { run: publicRun(db, id), ...run.diagnostic };
        }, opts?.signal),
    },
  };
}

function visibleEvents(db: DemoDb, runId: string, afterSeq: number): RunEvent[] {
  const run = db.runs.find((r) => r.id === runId);
  if (!run) fail(404, "NOT_FOUND", "Traitement introuvable.");
  const now = clock.now();
  return run.events.filter((e) => e.seq > afterSeq && Date.parse(e.at) <= now).sort((a, b) => a.seq - b.seq);
}

function publicRun(db: DemoDb, id: string): AgentRun {
  const run = db.runs.find((r) => r.id === id);
  if (!run) fail(404, "NOT_FOUND", "Traitement introuvable.");
  const { owner: _o, events: _e, diagnostic: _d, cancelled_at: _c, ...rest } = run;
  return clone(rest);
}

function publicCase(c: OwnedCase): SupportCase {
  const { owner: _o, ...rest } = c;
  return rest;
}

// ------------------------------------------------------------------ outils propres au mode démo

/** Page du prestataire de TEST : simule le choix du résultat côté prestataire, jamais côté plateforme. */
export const demoPaymentProvider = {
  async getSession(sessionId: string) {
    return handle((db) => {
      const session = db.payment_sessions.find((s) => s.id === sessionId);
      if (!session) fail(404, "NOT_FOUND", "Session de paiement introuvable.");
      const order = db.orders.find((o) => o.id === session.order_id)!;
      return { session_id: session.id, order_id: order.id, reference: order.reference, total: order.total, label: order.lines[0]!.label, expires_at: session.expires_at, submitted: session.outcome !== null };
    });
  },
  async submit(sessionId: string, outcome: "succeeded" | "succeeded_delayed" | "failed" | "cancelled" | "no_response") {
    return handle((db) => {
      const session = db.payment_sessions.find((s) => s.id === sessionId);
      if (!session) fail(404, "NOT_FOUND", "Session de paiement introuvable.");
      if (!session.outcome) {
        session.outcome = outcome === "succeeded_delayed" ? "succeeded" : outcome;
        const delays: Record<typeof outcome, number | null> = { succeeded: 2500, succeeded_delayed: 9000, failed: 1200, cancelled: 800, no_response: null };
        const ms = delays[outcome];
        session.deliver_at = ms === null ? null : isoIn(ms);
        const order = db.orders.find((o) => o.id === session.order_id);
        if (order && order.status === "pending_payment") order.payment = { status: "pending", provider: "test", mode: "test", updated_at: clock.iso() };
      }
      return { return_url: `/commande/${session.order_id}/retour` };
    });
  },
};

export const demoControls = {
  setOutage(on: boolean) {
    const db = getDb();
    db.flags.outage = on;
    saveDb();
  },
  isOutage: () => getDb().flags.outage,
  expireSession() {
    const db = getDb();
    setDemoSessionUserId(null);
    db.flags.session_expired = true;
    saveDb();
  },
  personas: () =>
    getDb()
      .users.filter((u) => u.id.startsWith("u_") && ["u_hery", "u_fara", "u_support", "u_manager", "u_admin"].includes(u.id))
      .map((u) => ({ id: u.id, email: u.email, display_name: u.display_name, roles: u.roles })),
  /** Référence publique : identifiants des personas fictives. */
  demoPassword: "demo",
};

