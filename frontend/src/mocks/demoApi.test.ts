import { ApiError } from "@/contracts/errors";
import { createDemoApi, demoPaymentProvider } from "./demoApi";
import { clock, getDb } from "./db";

/**
 * Ces tests vérifient la cohérence du mode démonstration avec les règles du cahier des charges.
 * Ils NE prouvent PAS le comportement du backend réel (quota atomique PostgreSQL, webhooks,
 * autorisations MCP), qui reste à tester côté serveur.
 */
const api = createDemoApi();
const login = (who: "hery" | "fara" | "support" | "responsable" | "admin") => api.auth.login({ email: `${who}@demo.kiosy.invalid`, password: "demo" });

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  if (status) expect((error as ApiError).status).toBe(status);
}

async function payAndDeliver(orderId: string) {
  const session = await api.commerce.createCheckout(orderId, { idempotencyKey: `co-${orderId}` });
  await demoPaymentProvider.submit(session.session_id, "succeeded");
  clock.advance(3000);
  return api.commerce.getOrder(orderId);
}

describe("mode démo : achat et droits", () => {
  it("bloque le doublon strict d'un contenu déjà acheté", async () => {
    await login("hery");
    const [elig] = await api.me.eligibility(["off_e_e06a"]);
    expect(elig?.blocking_reason).toBe("ALREADY_OWNED");
    await expectCode(api.commerce.createOrder({ quote_id: "quote-owned", offer_id: "off_e_e06a", offer_version: 1, accepted_conditions_version: "démo-0.1" }, { idempotencyKey: "k1" }), "ALREADY_OWNED", 409);
  });

  it("signale une offre indisponible (droits expirés)", async () => {
    await login("hery");
    const [elig] = await api.me.eligibility(["off_e_e10a"]);
    expect(elig?.blocking_reason).toBe("OFFER_UNAVAILABLE");
  });

  it("n'attribue l'accès qu'après la notification du prestataire", async () => {
    await login("hery");
    const input = { quote_id: "quote-buy-1", offer_id: "off_e_e09a", offer_version: 1, accepted_conditions_version: "démo-0.1" };
    const order = await api.commerce.createOrder(input, { idempotencyKey: "buy-1" });
    expect(order.status).toBe("pending_payment");
    await expectCode(api.me.assetAccess("e09a"), "ACCESS_DENIED", 403);
    const session = await api.commerce.createCheckout(order.id, { idempotencyKey: "co-1" });
    await demoPaymentProvider.submit(session.session_id, "succeeded");
    expect((await api.commerce.getOrder(order.id)).status).toBe("pending_payment"); // retour ≠ preuve
    clock.advance(3000);
    expect((await api.commerce.getOrder(order.id)).status).toBe("fulfilled");
    const access = await api.me.assetAccess("e09a");
    expect(access.media_type).toBe("text/markdown");
    expect((await api.me.library()).some((i) => i.edition.id === "e09a")).toBe(true);
  });

  it("applique l'idempotence : même clé et même corps = même commande ; corps différent = 409", async () => {
    await login("hery");
    const input = { quote_id: "quote-same", offer_id: "off_e_e13a", offer_version: 1, accepted_conditions_version: "démo-0.1" };
    const a = await api.commerce.createOrder(input, { idempotencyKey: "same" });
    const b = await api.commerce.createOrder(input, { idempotencyKey: "same" });
    expect(b.id).toBe(a.id);
    await expectCode(api.commerce.createOrder({ ...input, offer_id: "off_e_e14a" }, { idempotencyKey: "same" }), "IDEMPOTENCY_MISMATCH", 409);
    expect(getDb().orders.filter((o) => o.lines[0]?.snapshot.offer_id === "off_e_e13a")).toHaveLength(1);
  });

  it("refuse une commande si l'offre a changé de version", async () => {
    await login("hery");
    await expectCode(api.commerce.createOrder({ quote_id: "quote-version", offer_id: "off_sub_business", offer_version: 99, accepted_conditions_version: "démo-0.1" }, { idempotencyKey: "v" }), "OFFER_CHANGED", 409);
  });

  it("gère le quota : épuisement, expiration de réservation et restitution unique", async () => {
    const quota = () => getDb().offers.find((o) => o.id === "off_launch_e07a")!.quota!.remaining;
    const input = { quote_id: "quote-quota", offer_id: "off_launch_e07a", offer_version: 1, accepted_conditions_version: "démo-0.1" };
    await login("hery");
    const first = await api.commerce.createOrder(input, { idempotencyKey: "q1" });
    await login("fara");
    await api.commerce.createOrder(input, { idempotencyKey: "q2" });
    expect(quota()).toBe(0);
    await login("admin");
    // Même un autre compte ne peut plus réserver.
    getDb().users.find((u) => u.id === "u_admin")!.roles.push("reader");
    await expectCode(api.commerce.createOrder(input, { idempotencyKey: "q3" }), "OFFER_SOLD_OUT", 409);
    clock.advance(11 * 60 * 1000); // réservations expirées
    await login("hery");
    expect((await api.commerce.getOrder(first.id)).status).toBe("cancelled");
    expect(quota()).toBe(2);
    await api.me.library(); // nouveau passage des tâches planifiées
    expect(quota()).toBe(2); // pas de double restitution
  });

  it("laisse un paiement sans réponse en attente jusqu'à la réconciliation", async () => {
    await login("fara");
    const order = await api.commerce.getOrder("ord_f2");
    expect(order.payment?.status).toBe("pending");
    await expectCode(api.commerce.createCheckout("ord_f2", { idempotencyKey: "x" }), "PAYMENT_PENDING", 409);
    await login("admin");
    const reconciled = await api.admin.reconcilePayment("ord_f2");
    expect(reconciled.status).toBe("fulfilled");
  });

  it("isole les dossiers : un lecteur ne voit pas la commande d'un autre", async () => {
    await login("hery");
    await expectCode(api.commerce.getOrder("ord_f2"), "NOT_FOUND", 404);
    await expectCode(api.support.get("case_f1"), "NOT_FOUND", 404);
    await expectCode(api.admin.ops(), "ACCESS_DENIED", 403);
  });
});

describe("mode démo : propositions et approbations", () => {
  it("refuse une proposition expirée (409) sans rien exécuter", async () => {
    await login("hery");
    const proposal = await api.proposals.prepareCancellation("sub_hery_culture");
    clock.advance(16 * 60 * 1000);
    await expectCode(api.proposals.confirm(proposal.id, { idempotencyKey: "c1" }), "PROPOSAL_EXPIRED", 409);
    expect((await api.me.subscription("sub_hery_culture")).status).toBe("active");
  });

  it("refuse une proposition devenue obsolète puis rejoue le résultat initial pour la même clé", async () => {
    await login("hery");
    const stale = await api.proposals.preparePlanChange("sub_hery_culture", "off_sub_culture_q");
    const cancel = await api.proposals.prepareCancellation("sub_hery_culture");
    const done = await api.proposals.confirm(cancel.id, { idempotencyKey: "cancel" });
    expect(done.status).toBe("confirmed");
    const again = await api.proposals.confirm(cancel.id, { idempotencyKey: "cancel" });
    expect(again.status).toBe("confirmed");
    expect(getDb().subscriptions.find((s) => s.id === "sub_hery_culture")!.history.filter((h) => h.label.startsWith("Résiliation"))).toHaveLength(1);
    await expectCode(api.proposals.confirm(stale.id, { idempotencyKey: "pc" }), "PROPOSAL_STALE", 409);
  });

  it("interdit à un demandeur d'approuver sa propre exception", async () => {
    await login("responsable");
    const request = await api.admin.requestAccessException("case_f1", { reason: "Page blanche confirmée par le support.", edition_id: "e02b", days: 3 });
    await expectCode(api.admin.decideApproval(request.id, { decision: "approve", reason: "ok ok" }, { idempotencyKey: "d" }), "SELF_APPROVAL_FORBIDDEN", 403);
    await login("support");
    await expectCode(api.admin.decideApproval("appr_1", { decision: "approve", reason: "ok ok" }, { idempotencyKey: "d2" }), "ACCESS_DENIED", 403);
  });
});

describe("mode démo : assistant simulé", () => {
  it("mobilise plusieurs spécialistes et prépare une proposition sans rien exécuter", async () => {
    await login("hery");
    const conversation = await api.assistant.createConversation();
    const started = await api.assistant.startRun(conversation.id, { text: "Je veux une offre business et agriculture sans repayer mes accès" }, { idempotencyKey: "r1" });
    clock.advance(10_000);
    const run = await api.assistant.getRun(started.run_id);
    expect(run.status).toBe("waiting_approval");
    const diag = getDb().runs.find((r) => r.id === started.run_id)!.diagnostic;
    expect(new Set(diag.steps.map((s) => s.agent)).size).toBeGreaterThanOrEqual(3);
    const messages = await api.assistant.listMessages(conversation.id);
    const blocks = messages.at(-1)!.blocks;
    expect(blocks.some((b) => b.type === "notice" && b.text.includes("agriculture"))).toBe(true);
    expect(blocks.some((b) => b.type === "proposal")).toBe(true);
    expect(getDb().orders.filter((o) => o.user_id === "u_hery" && o.status === "pending_payment")).toHaveLength(0);
  });

  it("invite un visiteur à se connecter pour une demande personnelle", async () => {
    const conversation = await api.assistant.createConversation();
    await api.assistant.startRun(conversation.id, { text: "Pourquoi je n'ai plus accès à mon abonnement ?" }, { idempotencyKey: "r2" });
    clock.advance(5000);
    const messages = await api.assistant.listMessages(conversation.id);
    expect(messages.at(-1)!.blocks[0]?.type).toBe("auth_required");
  });

  it("ne publie pas un message dont l'échéance n'est pas atteinte, et l'annulation le retire", async () => {
    await login("hery");
    const conversation = await api.assistant.createConversation();
    const started = await api.assistant.startRun(conversation.id, { text: "Compare les abonnements" }, { idempotencyKey: "r3" });
    expect((await api.assistant.listMessages(conversation.id)).map((m) => m.role)).toEqual(["user"]);
    const cancelled = await api.assistant.cancelRun(started.run_id);
    expect(cancelled.status).toBe("cancelled");
    clock.advance(10_000);
    expect((await api.assistant.listMessages(conversation.id)).map((m) => m.role)).toEqual(["user"]);
  });
});

describe("mode démo : paiement complet d'un abonnement", () => {
  it("crée l'abonnement et ouvre toute la collection après paiement", async () => {
    await login("fara");
    const order = await api.commerce.createOrder({ quote_id: "quote-sub", offer_id: "off_sub_culture", offer_version: 2, accepted_conditions_version: "démo-0.1" }, { idempotencyKey: "sub" });
    const done = await payAndDeliver(order.id);
    expect(done.status).toBe("fulfilled");
    const access = await api.me.access("p11");
    expect(access.readable_edition_ids).toContain("e11a");
  });
});

describe("mode démo : administration éditoriale", () => {
  it("crée une offre complète et conserve sa version initiale", async () => {
    await login("admin");
    const edition = (await api.admin.editions({}))[0]!;
    const offer = await api.admin.createOffer({
      kind: "single", title: "Offre de recette", description: "Accès de recette à une édition.",
      price: { amount: 12000, currency: "MGA", scale: 0 }, duration: { unit: "month", count: 6 },
      scope: { kind: "edition", edition_id: edition.edition.id, publication_id: edition.publication.id, label: edition.publication.title },
      restrictions: ["Usage individuel"], conditions_version: "démo-0.1", quota_total: 5, status: "active",
    });
    expect(offer.version).toBe(1);
    expect(offer.quota).toEqual({ total: 5, remaining: 5 });
    expect(await api.admin.offerVersions(offer.id)).toHaveLength(1);
  });

  it("ajoute une édition sans remplacer les précédentes", async () => {
    await login("admin");
    const before = await api.admin.editions({});
    const publication = before[0]!.publication;
    const previousCount = before.filter((row) => row.publication.id === publication.id).length;
    const created = await api.admin.createEdition(publication.id, {
      label: "Édition suivante", format: "pdf", published_at: new Date().toISOString(),
      permissions: { public_excerpt: true, ai_indexing: false, full_text_public: false }, is_free: false,
    });
    expect(created.edition.status).toBe("draft");
    const after = await api.admin.editions({});
    expect(after.filter((row) => row.publication.id === publication.id)).toHaveLength(previousCount + 1);
  });
});
