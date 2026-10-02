import type {
  AuditEvent,
  Edition,
  Entitlement,
  Money,
  Offer,
  OfferSnapshot,
  Publication,
  RunEvent,
  Universe,
} from "@/contracts/models";
import type {
  DemoDb,
  DemoUser,
  OwnedCase,
  OwnedOrder,
  OwnedSubscription,
  ScheduledImport,
  ScheduledMessage,
  ScheduledRun,
} from "./db";
import {
  DEMO_PUBLICATIONS,
  DEMO_PUBLISHERS,
  DEMO_SUBSCRIPTION_OFFERS,
  SINGLE_PURCHASE_ACCESS_MONTHS,
} from "./fixtures/catalog";
import { TERMS_VERSION } from "@/content/terms";

const DAY = 24 * 60 * 60 * 1000;

export const UNIVERSE_LABEL: Record<Universe, string> = { presse: "Presse", business: "Business", culture: "Culture" };

export function mga(amount: number): Money {
  return { amount, currency: "MGA", scale: 0 };
}

export function snapshotOf(offer: Offer): OfferSnapshot {
  return {
    offer_id: offer.id,
    offer_version: offer.version,
    title: offer.title,
    kind: offer.kind,
    price: offer.price,
    duration: offer.duration,
    renewal: offer.renewal,
    scope_label: offer.scope.label,
    conditions_version: offer.conditions_version,
  };
}

export function singleOfferId(editionId: string): string {
  return `off_e_${editionId}`;
}

export function seedDemoDb(): DemoDb {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY).toISOString();
  const inDays = (days: number) => new Date(now + days * DAY).toISOString();

  const publishers = DEMO_PUBLISHERS.map((p) => ({ ...p }));
  const publications: Publication[] = [];
  const editions: Edition[] = [];
  const offers: Offer[] = [];

  for (const fixture of DEMO_PUBLICATIONS) {
    const publisher = publishers.find((p) => p.id === fixture.publisherId)!;
    publications.push({
      id: fixture.id,
      slug: fixture.slug,
      title: fixture.title,
      author: fixture.author,
      publisher,
      universe: fixture.universe,
      language: "fr",
      summary: fixture.summary,
      tags: fixture.tags,
      cover: fixture.cover,
      kind: fixture.kind,
      is_demo: true,
    });
    for (const ed of fixture.editions) {
      const status = ed.status ?? "published";
      editions.push({
        id: ed.id,
        publication_id: fixture.id,
        label: ed.label,
        published_at: ago(ed.daysAgo),
        format: fixture.format,
        language: "fr",
        page_count: fixture.format === "pdf" ? (ed.pages ?? 3) : null,
        word_count: fixture.format === "text" ? fixture.body.split(/\s+/).length : null,
        status,
        availability: ed.rightsExpired
          ? { state: "rights_expired", territories: ["MG", "FR", "RE"], rights_valid_until: ago(20), reason: "Droits de diffusion expirés (fictif)." }
          : { state: "available", territories: ["MG", "FR", "RE", "MU", "CA"], rights_valid_until: inDays(365), reason: null },
        permissions: { public_excerpt: !ed.rightsExpired, ai_indexing: !ed.rightsExpired, full_text_public: Boolean(ed.free) },
        is_free: Boolean(ed.free),
        version: 1,
        asset_id: status === "published" ? `asset_${ed.id}` : null,
      });
      if (ed.price !== null) {
        offers.push({
          id: singleOfferId(ed.id),
          version: 1,
          kind: "single",
          title: `${fixture.title} — ${ed.label}`,
          description: "Achat à l'unité de cette édition.",
          price: mga(ed.price),
          duration: { unit: "month", count: SINGLE_PURCHASE_ACCESS_MONTHS },
          renewal: "none",
          scope: { kind: "edition", edition_id: ed.id, publication_id: fixture.id, label: `${fixture.title}, ${ed.label}` },
          restrictions: ["Usage personnel uniquement.", "Lecture en ligne ; téléchargement selon la licence de l'éditeur."],
          conditions_version: TERMS_VERSION,
          status: ed.rightsExpired ? "unavailable" : status === "published" ? "active" : "retired",
          status_reason: ed.rightsExpired ? "Droits de diffusion expirés : vente suspendue." : null,
          quota: null,
          is_demo: true,
        });
      }
    }
  }

  // Offre promotionnelle explicitement contingentée (CON01) : seule offre avec quota.
  offers.push({
    id: "off_launch_e07a",
    version: 1,
    kind: "single",
    title: "Marchés & Filières — Octobre 2026, offre de lancement",
    description: "Prix de lancement réservé aux 50 premiers lecteurs (quota fictif).",
    price: mga(2000),
    duration: { unit: "month", count: SINGLE_PURCHASE_ACCESS_MONTHS },
    renewal: "none",
    scope: { kind: "edition", edition_id: "e07a", publication_id: "p07", label: "Marchés & Filières, Octobre 2026" },
    restrictions: ["Offre limitée à 50 exemplaires.", "Une seule commande par compte.", "Usage personnel uniquement."],
    conditions_version: TERMS_VERSION,
    status: "active",
    status_reason: null,
    quota: { total: 50, remaining: 2 },
    is_demo: true,
  });

  for (const sub of DEMO_SUBSCRIPTION_OFFERS) {
    offers.push({
      id: sub.id,
      version: 1,
      kind: "subscription",
      title: sub.title,
      description: `Toutes les éditions publiées de l'univers ${UNIVERSE_LABEL[sub.universe]}, y compris celles ajoutées pendant la période.`,
      price: mga(sub.price),
      duration: { unit: "month", count: sub.months },
      renewal: "manual",
      scope: {
        kind: "collection",
        universe: sub.universe,
        label: `Univers ${UNIVERSE_LABEL[sub.universe]}`,
        includes_future_additions: true,
      },
      restrictions: ["Abonnement individuel, non partageable.", "Renouvellement manuel : aucun prélèvement automatique."],
      conditions_version: TERMS_VERSION,
      status: "active",
      status_reason: null,
      quota: null,
      is_demo: true,
    });
  }

  offers.push({
    id: "off_free",
    version: 1,
    kind: "free",
    title: "Sélection gratuite",
    description: "Éditions gratuites et extraits publics, accessibles sans achat.",
    price: mga(0),
    duration: null,
    renewal: "none",
    scope: { kind: "free_selection", label: "Sélection gratuite et extraits" },
    restrictions: ["Contenus choisis par les éditeurs ; la sélection peut évoluer."],
    conditions_version: TERMS_VERSION,
    status: "active",
    status_reason: null,
    quota: null,
    is_demo: true,
  });

  const offerHistory: Record<string, Offer[]> = {};
  for (const offer of offers) offerHistory[offer.id] = [offer];

  // Historique d'une version antérieure pour illustrer le versionnement (OFF01).
  const cultureOffer = offers.find((o) => o.id === "off_sub_culture")!;
  offerHistory["off_sub_culture"] = [{ ...cultureOffer, version: 1, price: mga(10000) }, { ...cultureOffer, version: 2 }];
  cultureOffer.version = 2;

  const users: DemoUser[] = [
    {
      id: "u_hery",
      email: "hery@demo.kiosy.invalid",
      display_name: "Hery R. (fictif)",
      roles: ["reader"],
      publisher_id: null,
      preferences: { time_zone: "Indian/Antananarivo", language: "fr" },
      is_demo: true,
      demo_password: "demo",
    },
    {
      id: "u_fara",
      email: "fara@demo.kiosy.invalid",
      display_name: "Fara A. (fictif)",
      roles: ["reader"],
      publisher_id: null,
      preferences: { time_zone: "Europe/Paris", language: "fr" },
      is_demo: true,
      demo_password: "demo",
    },
    {
      id: "u_support",
      email: "support@demo.kiosy.invalid",
      display_name: "Nirina — support (fictif)",
      roles: ["support"],
      publisher_id: null,
      preferences: { time_zone: "Indian/Antananarivo", language: "fr" },
      is_demo: true,
      demo_password: "demo",
    },
    {
      id: "u_manager",
      email: "responsable@demo.kiosy.invalid",
      display_name: "Voahangy — responsable (fictif)",
      roles: ["manager", "support"],
      publisher_id: null,
      preferences: { time_zone: "Indian/Antananarivo", language: "fr" },
      is_demo: true,
      demo_password: "demo",
    },
    {
      id: "u_admin",
      email: "admin@demo.kiosy.invalid",
      display_name: "Tahina — administration (fictif)",
      roles: ["admin"],
      publisher_id: null,
      preferences: { time_zone: "Indian/Antananarivo", language: "fr" },
      is_demo: true,
      demo_password: "demo",
    },
  ];

  const offerById = (id: string) => offers.find((o) => o.id === id)!;
  const entitlements: Entitlement[] = [];
  const subscriptions: OwnedSubscription[] = [];
  const orders: OwnedOrder[] = [];

  const makeOrder = (
    id: string,
    reference: string,
    userId: string,
    offer: Offer,
    createdDaysAgo: number,
    status: OwnedOrder["status"],
    extra: Partial<OwnedOrder> = {},
  ): OwnedOrder => ({
    id,
    reference,
    user_id: userId,
    status,
    lines: [{ label: offer.title, snapshot: snapshotOf(offer), amount: offer.price }],
    total: offer.price,
    created_at: ago(createdDaysAgo),
    updated_at: ago(createdDaysAgo),
    payment: { status: "succeeded", provider: "test", mode: "test", updated_at: ago(createdDaysAgo) },
    reservation: null,
    subscription_id: null,
    edition_id: offer.scope.kind === "edition" ? offer.scope.edition_id : null,
    renewal_of_subscription_id: null,
    receipt_available: false,
    exception_reason: null,
    is_demo: true,
    ...extra,
  });

  // --- Hery : abonnement Culture actif, N° 12 du Trimestriel acheté, ancien abonnement Presse expiré.
  subscriptions.push({
    id: "sub_hery_culture",
    user_id: "u_hery",
    version: 1,
    offer: snapshotOf(cultureOffer),
    universe: "culture",
    status: "active",
    current_period_start: ago(18),
    current_period_end: inDays(12),
    renewal: "manual",
    scope_label: "Univers Culture",
    scheduled_change: null,
    history: [
      { at: ago(18), label: "Abonnement activé après confirmation du paiement de test." },
    ],
  });
  entitlements.push({
    id: "ent_h1",
    user_id: "u_hery",
    source: "subscription",
    source_ref: "sub_hery_culture",
    scope: { kind: "collection", universe: "culture", label: "Univers Culture" },
    valid_from: ago(18),
    valid_until: inDays(12),
    status: "active",
  });
  orders.push(makeOrder("ord_h1", "KY-2026-0141", "u_hery", cultureOffer, 18, "fulfilled", { subscription_id: "sub_hery_culture" }));

  const trimestriel = offerById(singleOfferId("e06a"));
  entitlements.push({
    id: "ent_h2",
    user_id: "u_hery",
    source: "purchase",
    source_ref: "ord_h2",
    scope: { kind: "edition", edition_id: "e06a" },
    valid_from: ago(25),
    valid_until: inDays(365 - 25),
    status: "active",
  });
  orders.push(makeOrder("ord_h2", "KY-2026-0127", "u_hery", trimestriel, 25, "fulfilled"));

  const presseOffer = offerById("off_sub_presse");
  subscriptions.push({
    id: "sub_hery_presse",
    user_id: "u_hery",
    version: 1,
    offer: snapshotOf(presseOffer),
    universe: "presse",
    status: "expired",
    current_period_start: ago(75),
    current_period_end: ago(45),
    renewal: "manual",
    scope_label: "Univers Presse",
    scheduled_change: null,
    history: [
      { at: ago(75), label: "Abonnement activé après confirmation du paiement de test." },
      { at: ago(45), label: "Période terminée sans renouvellement : accès expiré." },
    ],
  });
  entitlements.push({
    id: "ent_h3",
    user_id: "u_hery",
    source: "subscription",
    source_ref: "sub_hery_presse",
    scope: { kind: "collection", universe: "presse", label: "Univers Presse" },
    valid_from: ago(75),
    valid_until: ago(45),
    status: "expired",
  });
  orders.push(makeOrder("ord_h3", "KY-2026-0068", "u_hery", presseOffer, 75, "fulfilled", { subscription_id: "sub_hery_presse" }));

  // --- Fara : Presse actif mais résilié à échéance ; une commande au paiement incertain.
  subscriptions.push({
    id: "sub_fara_presse",
    user_id: "u_fara",
    version: 2,
    offer: snapshotOf(presseOffer),
    universe: "presse",
    status: "cancel_at_period_end",
    current_period_start: ago(10),
    current_period_end: inDays(20),
    renewal: "manual",
    scope_label: "Univers Presse",
    scheduled_change: null,
    history: [
      { at: ago(10), label: "Abonnement activé après confirmation du paiement de test." },
      { at: ago(2), label: "Résiliation confirmée : l'accès reste ouvert jusqu'à la fin de la période." },
    ],
  });
  entitlements.push({
    id: "ent_f1",
    user_id: "u_fara",
    source: "subscription",
    source_ref: "sub_fara_presse",
    scope: { kind: "collection", universe: "presse", label: "Univers Presse" },
    valid_from: ago(10),
    valid_until: inDays(20),
    status: "active",
  });
  orders.push(makeOrder("ord_f1", "KY-2026-0152", "u_fara", presseOffer, 10, "fulfilled", { subscription_id: "sub_fara_presse" }));

  const guide = offerById(singleOfferId("e08a"));
  orders.push(
    makeOrder("ord_f2", "KY-2026-0163", "u_fara", guide, 1, "pending_payment", {
      payment: { status: "pending", provider: "test", mode: "test", updated_at: ago(1) },
    }),
  );

  const payment_sessions = [
    { id: "ps_f2", order_id: "ord_f2", expires_at: ago(0.9), outcome: "no_response" as const, deliver_at: null, delivered: false },
  ];

  const cases: OwnedCase[] = [
    {
      id: "case_h1",
      reference: "AS-0031",
      owner: "u_hery",
      subject: "Téléchargement du PDF impossible",
      category: "access",
      status: "resolved",
      created_at: ago(30),
      updated_at: ago(29),
      requester: { id: "u_hery", label: "Hery R. (fictif)" },
      assignee: { id: "u_support", label: "Nirina — support (fictif)" },
      related: { order_id: "ord_h2", edition_id: "e06a", subscription_id: null },
      messages: [
        { id: "m1", author: "reader", author_label: "Hery R. (fictif)", body: "Le bouton de téléchargement du N° 12 ne réagit pas.", at: ago(30) },
        {
          id: "m2",
          author: "support",
          author_label: "Nirina — support (fictif)",
          body: "Le lien de téléchargement expire après quelques minutes. Rouvrez la lecture pour en générer un nouveau.",
          at: ago(29),
        },
      ],
    },
    {
      id: "case_f1",
      reference: "AS-0044",
      owner: "u_fara",
      subject: "Je n'arrive pas à ouvrir l'Hebdo N° 213",
      category: "access",
      status: "in_progress",
      created_at: ago(2),
      updated_at: ago(1),
      requester: { id: "u_fara", label: "Fara A. (fictif)" },
      assignee: { id: "u_support", label: "Nirina — support (fictif)" },
      related: { order_id: null, edition_id: "e02b", subscription_id: "sub_fara_presse" },
      messages: [
        { id: "m3", author: "reader", author_label: "Fara A. (fictif)", body: "La page reste blanche quand j'ouvre le N° 213.", at: ago(2) },
        {
          id: "m4",
          author: "support",
          author_label: "Nirina — support (fictif)",
          body: "Nous vérifions votre accès. Une demande d'accès exceptionnel a été transmise à un responsable.",
          at: ago(1),
        },
      ],
    },
  ];

  const approvalProposal = {
    id: "prop_seed_exception",
    user_id: "u_support",
    type: "access_exception" as const,
    status: "pending" as const,
    title: "Accès exceptionnel de 7 jours à l'Hebdo Océan Indien N° 213",
    resource: { type: "edition", id: "e02b", label: "Hebdo Océan Indien, N° 213", version: 1 },
    consequences: [
      "Fara A. (fictif) obtient un accès de lecture de 7 jours à cette édition.",
      "L'attribution est tracée dans l'audit avec le motif et l'approbateur.",
    ],
    amount: null,
    conditions_version: null,
    expires_at: inDays(2),
    approval: "manager" as const,
    origin: "form" as const,
    created_at: ago(1),
    result: null,
    payload: { edition_id: "e02b", days: 7, beneficiary_id: "u_fara" },
    run_id: null,
  };

  const audit: AuditEvent[] = [
    auditEvent(ago(30), { id: "u_admin", label: "Tahina — administration (fictif)", role: "admin" }, "edition.publish", { type: "edition", id: "e06a", label: "Le Trimestriel de l'Entreprise, N° 12" }, null, "success"),
    auditEvent(ago(25), { id: "system", label: "Traitement des paiements", role: "system" }, "order.fulfill", { type: "order", id: "ord_h2", label: "KY-2026-0127" }, "Notification de paiement de test vérifiée.", "success"),
    auditEvent(ago(20), { id: "u_support", label: "Nirina — support (fictif)", role: "support" }, "approval.decide", { type: "approval", id: "appr_old", label: "Remboursement manuel" }, "Le demandeur ne peut pas approuver sa propre demande.", "denied"),
    auditEvent(ago(2), { id: "u_fara", label: "Fara A. (fictif)", role: "reader" }, "subscription.cancel_at_period_end", { type: "subscription", id: "sub_fara_presse", label: "Abonnement Presse — mensuel" }, null, "success"),
    auditEvent(ago(1), { id: "u_support", label: "Nirina — support (fictif)", role: "support" }, "approval.request", { type: "edition", id: "e02b", label: "Hebdo Océan Indien, N° 213" }, "Page blanche signalée par la lectrice ; accès temporaire proposé.", "success"),
  ];

  const imports: ScheduledImport[] = [
    {
      id: "imp_1",
      file_name: "trimestriel-12.pdf",
      size_bytes: 1_824_311,
      media_type: "application/pdf",
      edition_id: "e06a",
      edition_label: "Le Trimestriel de l'Entreprise, N° 12",
      status: "ready",
      progress: 100,
      error: null,
      warnings: [],
      created_at: ago(31),
      updated_at: ago(31),
      schedule: [],
      final_error: null,
    },
    {
      id: "imp_2",
      file_name: "cahiers-region-scan.pdf",
      size_bytes: 9_120_004,
      media_type: "application/pdf",
      edition_id: "e03a",
      edition_label: "Cahiers de la Région, Septembre 2026",
      status: "failed",
      progress: 60,
      error: { code: "NO_EXTRACTABLE_TEXT", message: "Aucun texte extractible : document numérisé. L'OCR n'est pas disponible au MVP." },
      warnings: [],
      created_at: ago(7),
      updated_at: ago(7),
      schedule: [],
      final_error: null,
    },
  ];

  const { conversations, messages, runs } = seedAssistantHistory(ago);

  return {
    version: 3,
    counter: 100,
    users,
    publishers,
    publications,
    editions,
    offers,
    offer_history: offerHistory,
    entitlements,
    subscriptions,
    orders,
    payment_sessions,
    proposals: [approvalProposal],
    conversations,
    messages,
    runs,
    cases,
    imports,
    audit,
    approvals: [
      {
        id: "appr_1",
        proposal: approvalProposal,
        requested_by: { id: "u_support", label: "Nirina — support (fictif)" },
        reason: "Page blanche signalée à l'ouverture ; accès temporaire le temps du diagnostic.",
        status: "pending",
        decided_by: null,
        decided_at: null,
        case_id: "case_f1",
      },
    ],
    sessions: {},
    idempotency: {},
    flags: { outage: false, session_expired: false },
  };
}

let auditCounter = 0;
export function auditEvent(
  at: string,
  actor: AuditEvent["actor"],
  action: string,
  target: AuditEvent["target"],
  reason: string | null,
  result: AuditEvent["result"],
): AuditEvent {
  auditCounter += 1;
  return {
    id: `aud_${auditCounter}_${Math.random().toString(36).slice(2, 7)}`,
    at,
    actor,
    action,
    target,
    reason,
    result,
    request_id: `req_${Math.random().toString(36).slice(2, 10)}`,
  };
}

function seedAssistantHistory(ago: (days: number) => string) {
  const convId = "conv_hery_1";
  const runId = "run_seed_1";
  const at = ago(3);
  const conversations = [
    {
      id: convId,
      owner: "u_hery",
      title: "Une idée de lecture culture",
      created_at: at,
      updated_at: at,
      active_run_id: null,
      is_demo: true,
    },
  ];
  const messages: ScheduledMessage[] = [
    {
      id: "msg_seed_1",
      conversation_id: convId,
      owner: "u_hery",
      role: "user",
      created_at: at,
      visible_at: at,
      run_id: null,
      blocks: [{ type: "text", markdown: "Peux-tu me conseiller une lecture culture pour ce week-end ?" }],
    },
    {
      id: "msg_seed_2",
      conversation_id: convId,
      owner: "u_hery",
      role: "assistant",
      created_at: at,
      visible_at: at,
      run_id: runId,
      blocks: [
        {
          type: "text",
          markdown:
            "Votre abonnement **Culture** est actif : ces deux titres sont déjà inclus, vous pouvez les lire sans rien payer de plus.",
        },
        {
          type: "publications",
          items: [
            {
              publication_id: "p13",
              slug: "cinema-et-ecrans",
              title: "Cinéma & Écrans",
              subtitle: "Septembre 2026",
              universe: "culture",
              cover: { palette: ["#1B2230", "#F4EFE3", "#EF8354"], motif: "columns", kicker: "Cinéma" },
              reason: "Édition récente, lecture courte.",
            },
            {
              publication_id: "p12",
              slug: "contes-de-la-cote-est",
              title: "Contes de la côte Est",
              subtitle: "Recueil gratuit",
              universe: "culture",
              cover: { palette: ["#E3EFE9", "#1B2230", "#B4532A"], motif: "waves", kicker: "Contes" },
              reason: "À lire en famille.",
            },
          ],
        },
      ],
    },
  ];
  const events: RunEvent[] = [
    { seq: 1, run_id: runId, at, type: "status", status: "queued" },
    { seq: 2, run_id: runId, at, type: "status", status: "running" },
    { seq: 3, run_id: runId, at, type: "step", step: { key: "search", label: "Recherche de contenus", state: "done" } },
    { seq: 4, run_id: runId, at, type: "step", step: { key: "access", label: "Vérification de vos accès", state: "done" } },
    { seq: 5, run_id: runId, at, type: "message", message_id: "msg_seed_2" },
    { seq: 6, run_id: runId, at, type: "status", status: "completed" },
  ];
  const runs: ScheduledRun[] = [
    {
      id: runId,
      conversation_id: convId,
      owner: "u_hery",
      status: "completed",
      created_at: at,
      updated_at: at,
      last_seq: 6,
      steps: [
        { key: "search", label: "Recherche de contenus", state: "done" },
        { key: "access", label: "Vérification de vos accès", state: "done" },
      ],
      error: null,
      events,
      cancelled_at: null,
      diagnostic: {
        actor_label: "Hery R. (fictif)",
        request_summary: "Conseil de lecture, univers culture.",
        model: "simulation-démo (aucun modèle appelé)",
        prompt_version: "coordinateur@démo-0.1",
        tokens: null,
        cost: { amount_usd: null, kind: "unavailable", tariff_version: null },
        is_simulated: true,
        steps: [
          {
            id: "st1",
            agent: "conseil_editorial",
            tool: "search_publications",
            mcp_server: "catalogue",
            started_at: at,
            duration_ms: 900,
            status: "ok",
            error_code: null,
            summary: "2 candidats culture retenus.",
            evidence_refs: ["publication:p13", "publication:p12"],
          },
          {
            id: "st2",
            agent: "offres_abonnements",
            tool: "get_my_subscriptions",
            mcp_server: "abonnements",
            started_at: at,
            duration_ms: 600,
            status: "ok",
            error_code: null,
            summary: "Abonnement Culture actif : aucun achat nécessaire.",
            evidence_refs: ["subscription:sub_hery_culture"],
          },
        ],
      },
    },
  ];
  return { conversations, messages, runs };
}
