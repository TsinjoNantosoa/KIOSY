import type {
  Citation,
  MessageBlock,
  OfferComparisonRow,
  Publication,
  PublicationCardData,
  RunDiagnosticStep,
  RunStatus,
  Universe,
} from "@/contracts/models";
import { SUBSCRIPTION_GIVES_ACCESS } from "@/contracts/rules";
import { clock, type DemoDb, type DemoUser } from "./db";
import { findTermsSection, TERMS_EFFECTIVE_DAYS_AGO, TERMS_VERSION, type TermsDocument } from "@/content/terms";
import { UNIVERSE_LABEL } from "./seed";
import {
  activeEntitlements,
  createCancellationProposal,
  createPurchaseProposal,
  createSupportCaseProposal,
  eligibility,
  formatDateFor,
  isPublic,
  readAccess,
} from "./server";

/**
 * Scénarios SIMULÉS de l'assistant pour le mode démonstration.
 * Aucun modèle de langage ni serveur MCP n'est appelé : les « spécialistes » sont des fonctions
 * déterministes qui lisent les données de démo. Le diagnostic l'indique explicitement.
 */

export interface ScenarioStep {
  key: "search" | "compare" | "access" | "terms" | "prepare" | "support";
  agent: "conseil_editorial" | "offres_abonnements" | "conditions_droits" | "coordinateur";
  tool: string | null;
  server: "catalogue" | "abonnements" | "support" | null;
  durationMs: number;
  /** Démarre en même temps que l'étape précédente (recherches indépendantes, AG03). */
  parallel?: boolean;
  status: RunDiagnosticStep["status"];
  errorCode?: string;
  summary: string;
  evidence: string[];
}

export interface ScenarioPlan {
  steps: ScenarioStep[];
  blocks: MessageBlock[];
  finalStatus: RunStatus;
  proposalIds: string[];
  requestSummary: string;
  error: { code: string; message: string } | null;
  /** Délai supplémentaire d'expiration de proposition (scénario « proposition expirée »). */
}

export const STEP_LABELS: Record<ScenarioStep["key"], string> = {
  search: "Recherche de contenus",
  compare: "Comparaison des offres",
  access: "Vérification de vos accès",
  terms: "Lecture des conditions applicables",
  prepare: "Préparation de la proposition",
  support: "Préparation de votre demande d'assistance",
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ");
}

const has = (text: string, ...needles: string[]) => needles.some((n) => text.includes(n));

function detectUniverse(text: string): Universe | null {
  if (has(text, "business", "entreprise", "economi", "finance", "export", "gestion")) return "business";
  if (has(text, "culture", "cinema", "musique", "theatre", "conte", "poesie", "litter", "voyage", "art")) return "culture";
  if (has(text, "presse", "actualit", "journal", "quotidien", "hebdo", "info")) return "presse";
  return null;
}

function detectPublication(db: DemoDb, text: string): Publication | null {
  let best: { pub: Publication; score: number } | null = null;
  for (const pub of db.publications) {
    const words = normalize(pub.title)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5);
    const score = words.filter((w) => text.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { pub, score };
  }
  return best?.pub ?? null;
}

function card(db: DemoDb, pub: Publication, reason: string): PublicationCardData {
  const latest = db.editions
    .filter((e) => e.publication_id === pub.id && isPublic(e))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  return {
    publication_id: pub.id,
    slug: pub.slug,
    title: pub.title,
    subtitle: latest?.label ?? "",
    universe: pub.universe,
    cover: pub.cover,
    reason,
  };
}

function citation(slug: TermsDocument["slug"], sectionId: string): Citation {
  const found = findTermsSection(slug, sectionId)!;
  return {
    id: `${slug}#${sectionId}`,
    document_title: found.doc.title,
    section: found.section.title,
    quote: found.section.body,
    version: TERMS_VERSION,
    effective_date: new Date(clock.now() - TERMS_EFFECTIVE_DAYS_AGO * 86_400_000).toISOString(),
    // Référence construite par le « serveur » vers une page interne existante (pas d'URL inventée).
    href: `/conditions/${slug}#${sectionId}`,
  };
}

function subscriptionRows(db: DemoDb, user: DemoUser | null, highlight: Universe | null): OfferComparisonRow[] {
  return db.offers
    .filter((o) => o.kind === "subscription")
    .map((offer) => {
      const elig = eligibility(db, user, offer);
      const universe = offer.scope.kind === "collection" ? offer.scope.universe : null;
      const activeSub =
        user && universe
          ? db.subscriptions.find((s) => s.user_id === user.id && s.universe === universe && SUBSCRIPTION_GIVES_ACCESS[s.status])
          : undefined;
      let status: OfferComparisonRow["status"] = "neutral";
      let note: string | null = null;
      if (offer.status !== "active") status = "unavailable";
      else if (activeSub) {
        status = "redundant";
        note = `Vous êtes déjà abonné(e) à l'univers ${UNIVERSE_LABEL[activeSub.universe]} jusqu'au ${formatDateFor(user, activeSub.current_period_end)}.`;
      } else if (highlight && universe === highlight && offer.duration?.count === 1) {
        status = "recommended";
        note = elig.overlaps[0]?.description ?? "Correspond à votre demande.";
      }
      return {
        offer_id: offer.id,
        title: offer.title,
        price: offer.price,
        duration: offer.duration,
        renewal: offer.renewal,
        includes: offer.scope.label,
        note,
        status,
      };
    });
}

export function planScenario(db: DemoDb, user: DemoUser | null, rawText: string, runId: string): ScenarioPlan {
  const text = normalize(rawText);
  const plan: ScenarioPlan = { steps: [], blocks: [], finalStatus: "completed", proposalIds: [], requestSummary: "", error: null };
  const universe = detectUniverse(text);
  const publication = detectPublication(db, text);

  const personal = has(text, "mon ", "mes ", "mon abonnement", "acces", "deja", "repayer", "abonne", "souscri", "resilier", "commande", "ouvr", "bloqu");
  const wantsTest = has(text, "panne", "indisponible", "outil en panne", "test outil");

  // --- Outil indisponible : pas de résultat inventé, retour partiel ou escalade.
  if (wantsTest) {
    plan.requestSummary = "Vérification d'accès avec dépendance indisponible (scénario de panne).";
    plan.steps.push({
      key: "access",
      agent: "offres_abonnements",
      tool: "check_entitlement",
      server: "abonnements",
      durationMs: 1800,
      status: "failed",
      errorCode: "PROVIDER_UNAVAILABLE",
      summary: "Le serveur MCP Abonnements n'a pas répondu dans le délai imparti.",
      evidence: [],
    });
    plan.blocks.push(
      {
        type: "error",
        code: "PROVIDER_UNAVAILABLE",
        text: "Le service de vérification des abonnements ne répond pas. Je ne peux pas confirmer votre accès et je ne fais aucune supposition à sa place.",
        retryable: true,
      },
      {
        type: "handoff",
        text: "Vous pouvez réessayer dans quelques minutes, consulter directement votre bibliothèque, ou ouvrir une demande d'assistance.",
        case_id: null,
      },
    );
    plan.finalStatus = "failed";
    plan.error = { code: "PROVIDER_UNAVAILABLE", message: "Serveur MCP Abonnements indisponible (simulation)." };
    return plan;
  }

  // --- Demande personnelle d'un visiteur : invitation à se connecter, aucun dossier exposé.
  if (!user && personal && !has(text, "conseil", "recommand", "compar")) {
    plan.requestSummary = "Demande personnelle d'un visiteur non connecté.";
    plan.blocks.push({
      type: "auth_required",
      text: "Pour vérifier vos accès, vos abonnements ou préparer une commande, connectez-vous. Sans connexion, je ne consulte aucun dossier personnel.",
    });
    return plan;
  }

  // --- Scénario de référence : business + agriculture, sans repayer ses accès (section 12).
  if (has(text, "agricult", "agro", "elevage")) {
    plan.requestSummary = "Offre business et agriculture sans repayer les accès actuels.";
    const business = db.publications.filter((p) => p.universe === "business" && db.editions.some((e) => e.publication_id === p.id && isPublic(e) && e.availability.state === "available"));
    plan.steps.push({
      key: "search",
      agent: "conseil_editorial",
      tool: "search_publications",
      server: "catalogue",
      durationMs: 1100,
      status: "ok",
      summary: `0 publication sur l'agriculture ; ${universe === "business" ? business.length : 0} candidats business.`,
      evidence: business.map((p) => `publication:${p.id}`),
    });
    plan.steps.push({
      key: "terms",
      agent: "conditions_droits",
      tool: "search_terms",
      server: "support",
      durationMs: 900,
      parallel: true,
      status: "ok",
      summary: "Sections abonnement et renouvellement retenues (version démo-0.1).",
      evidence: ["terms:vente#abonnement", "terms:vente#renouvellement"],
    });
    plan.blocks.push({
      type: "notice",
      tone: "warning",
      text: "Le catalogue actuel ne contient aucune publication consacrée à l'agriculture. Je ne peux donc pas vous proposer d'offre sur ce thème.",
    });
    if (universe !== "business") {
      plan.blocks.push({ type: "clarification", question: "Souhaitez-vous que je regarde un autre thème ?", options: ["Voir l'offre Business", "Me conseiller une lecture", "Comparer les abonnements"] });
      plan.finalStatus = "waiting_user";
      return plan;
    }
    const rows = subscriptionRows(db, user, "business").filter((r) => r.offer_id.startsWith("off_sub_business"));
    const singles = user ? activeEntitlements(db, user.id).filter((e) => e.source === "purchase") : [];
    plan.steps.push({
      key: "compare",
      agent: "offres_abonnements",
      tool: user ? "get_my_subscriptions" : "compare_offers",
      server: user ? "abonnements" : "catalogue",
      durationMs: 1200,
      status: "ok",
      summary: user
        ? `Candidats du conseiller comparés aux accès existants : ${singles.length} achat(s) à l'unité, aucun abonnement Business actif.`
        : "Comparaison des offres Business sans données personnelles.",
      evidence: ["offer:off_sub_business", ...singles.map((e) => `entitlement:${e.id}`)],
    });
    plan.blocks.push({
      type: "text",
      markdown:
        "Pour la partie **business**, voici ce que je retiens après vérification de vos accès :\n\n" +
        (singles.length > 0
          ? `- Vous possédez déjà ${singles.length} édition(s) achetée(s) à l'unité : inutile de les racheter, elles restent accessibles.\n`
          : "") +
        "- L'**abonnement Business mensuel** couvre toutes les éditions business publiées, y compris les nouvelles.\n" +
        "- Le renouvellement est **manuel** : aucun prélèvement automatique.",
    });
    plan.blocks.push({ type: "publications", items: business.slice(0, 3).map((p) => card(db, p, "Inclus dans l'abonnement Business.")) });
    plan.blocks.push({ type: "offer_comparison", rows });
    plan.blocks.push({ type: "citations", items: [citation("vente", "abonnement"), citation("vente", "renouvellement")] });
    const offer = db.offers.find((o) => o.id === "off_sub_business")!;
    if (user && eligibility(db, user, offer).can_purchase) {
      plan.steps.push({ key: "prepare", agent: "coordinateur", tool: "prepare_purchase", server: "abonnements", durationMs: 700, status: "ok", summary: "Proposition de commande préparée (sans paiement).", evidence: ["offer:off_sub_business"] });
      const proposal = createPurchaseProposal(db, user, offer, "assistant", runId);
      plan.proposalIds.push(proposal.id);
      plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
      plan.finalStatus = "waiting_approval";
    } else if (!user) {
      plan.blocks.push({ type: "auth_required", text: "Connectez-vous pour que je vérifie vos accès et prépare une commande." });
    }
    return plan;
  }

  // --- Proposition volontairement très courte (scénario de démonstration d'expiration).
  if (has(text, "expir") && has(text, "proposition", "test", "demo")) {
    plan.requestSummary = "Scénario de démonstration : proposition à expiration rapide.";
    const offer = db.offers.find((o) => o.id === (universe ? `off_sub_${universe}` : "off_sub_business"))!;
    plan.steps.push({ key: "prepare", agent: "offres_abonnements", tool: "prepare_purchase", server: "abonnements", durationMs: 900, status: "ok", summary: "Proposition préparée avec une validité de quelques secondes.", evidence: [`offer:${offer.id}`] });
    if (user && eligibility(db, user, offer).can_purchase) {
      const proposal = createPurchaseProposal(db, user!, offer, "assistant", runId, 900 + 8000);
      plan.proposalIds.push(proposal.id);
      plan.blocks.push({ type: "notice", tone: "info", text: "Scénario de démonstration : cette proposition expire volontairement au bout de quelques secondes pour montrer le refus d'une proposition périmée." });
      plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
      plan.finalStatus = "waiting_approval";
    } else {
      plan.blocks.push({ type: "notice", tone: "info", text: `Vous disposez déjà de « ${offer.title} » ou l'offre n'est pas disponible : aucune proposition n'est préparée.` });
    }
    return plan;
  }

  // --- Problème d'accès : vérification puis demande d'assistance à confirmer.
  if (user && has(text, "acces", "ouvr", "bloqu", "page blanche", "n arrive pas", "probleme", "impossible")) {
    plan.requestSummary = "Diagnostic d'un problème d'accès.";
    const target = publication ? db.editions.filter((e) => e.publication_id === publication.id && isPublic(e)).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)) : [];
    const number = rawText.match(/\d{1,4}/)?.[0];
    const edition = target.find((e) => number && e.label.includes(number)) ?? target[0] ?? null;
    const access = edition ? readAccess(db, user, edition) : null;
    const expired = edition
      ? db.entitlements.find((e) => e.user_id === user.id && e.status === "expired" && (e.scope.kind === "edition" ? e.scope.edition_id === edition.id : e.scope.universe === publication?.universe))
      : undefined;
    plan.steps.push({
      key: "access",
      agent: "offres_abonnements",
      tool: "check_entitlement",
      server: "abonnements",
      durationMs: 1200,
      status: "ok",
      summary: edition ? (access ? "Accès actif confirmé." : expired ? "Accès expiré." : "Aucun droit sur cette édition.") : "Édition non identifiée dans la demande.",
      evidence: edition ? [`edition:${edition.id}`] : [],
    });
    let markdown: string;
    if (!edition) {
      markdown = "Je n'ai pas identifié la publication concernée. Vos accès actifs sont visibles dans votre [bibliothèque](/compte/bibliotheque). Je peux ouvrir une demande d'assistance pour qu'une personne vérifie avec vous.";
    } else if (access) {
      markdown = `Votre accès à **${publication!.title}, ${edition.label}** est actif${access !== "free" && access.valid_until ? ` jusqu'au ${formatDateFor(user, access.valid_until)}` : ""}. Le problème ne vient donc pas de vos droits.\n\n- Rouvrez la lecture : le lien de fichier est régénéré à chaque ouverture.\n- Si la page reste blanche, je peux transmettre le problème à l'assistance.\n\n[Ouvrir la lecture](/lire/${edition.id})`;
    } else if (expired) {
      const sub = db.subscriptions.find((s) => s.id === expired.source_ref);
      markdown = `Votre accès à **${publication!.title}** a expiré le ${formatDateFor(user, expired.valid_until!)}. C'est la cause la plus probable du blocage.${sub ? `\n\nVous pouvez [renouveler votre abonnement](/compte/abonnements/${sub.id}) : le renouvellement est manuel et ne déclenche aucun prélèvement automatique.` : ""}`;
    } else {
      markdown = `Cette édition n'est pas incluse dans vos accès actuels. Consultez [les offres de ${publication!.title}](/publications/${publication!.slug}) pour voir ce qui la couvre.`;
    }
    plan.blocks.push({ type: "text", markdown });
    plan.steps.push({ key: "support", agent: "coordinateur", tool: "create_support_case (préparation)", server: "support", durationMs: 600, status: "ok", summary: "Proposition de demande d'assistance préparée.", evidence: [] });
    const proposal = createSupportCaseProposal(
      db,
      user,
      {
        category: "access",
        subject: edition ? `Accès à ${publication!.title}, ${edition.label}` : "Problème d'accès à un contenu",
        body: rawText.slice(0, 280),
        edition_id: edition?.id ?? null,
      },
      runId,
    );
    plan.proposalIds.push(proposal.id);
    plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
    plan.finalStatus = "waiting_approval";
    return plan;
  }

  // --- Conditions (résiliation, remboursement, renouvellement) avec sources.
  if (has(text, "condition", "resili", "rembours", "renouvel", "cgv", "annul", "changer de formule", "changement")) {
    plan.requestSummary = "Question sur les conditions applicables.";
    const sections: [TermsDocument["slug"], string][] = [];
    if (has(text, "resili", "annul")) sections.push(["vente", "resiliation"]);
    if (has(text, "rembours")) sections.push(["vente", "remboursement"]);
    if (has(text, "renouvel")) sections.push(["vente", "renouvellement"]);
    if (has(text, "formule", "changement")) sections.push(["vente", "changement-formule"]);
    if (sections.length === 0) sections.push(["vente", "abonnement"], ["vente", "renouvellement"]);
    plan.steps.push({
      key: "terms",
      agent: "conditions_droits",
      tool: "search_terms",
      server: "support",
      durationMs: 1000,
      status: "ok",
      summary: `${sections.length} section(s) des conditions de vente, version ${TERMS_VERSION}.`,
      evidence: sections.map(([d, s]) => `terms:${d}#${s}`),
    });
    const cites = sections.map(([d, s]) => citation(d, s));
    plan.blocks.push({
      type: "text",
      markdown:
        "Voici ce que prévoient les conditions de vente **provisoires** de la démonstration :\n\n" +
        cites.map((c) => `- **${c.section}** : ${c.quote}`).join("\n") +
        "\n\nCes conditions n'ont pas encore été validées juridiquement.",
    });
    plan.blocks.push({ type: "citations", items: cites });
    const wantsCancel = has(text, "resili", "annul") && has(text, "mon", "je veux", "voudrais");
    if (wantsCancel && user) {
      const sub = db.subscriptions.find((s) => s.user_id === user.id && s.status === "active");
      plan.steps.push({ key: "access", agent: "offres_abonnements", tool: "get_my_subscriptions", server: "abonnements", durationMs: 800, status: "ok", summary: sub ? "Abonnement actif identifié." : "Aucun abonnement actif résiliable.", evidence: sub ? [`subscription:${sub.id}`] : [] });
      if (sub) {
        plan.steps.push({ key: "prepare", agent: "offres_abonnements", tool: "prepare_cancellation", server: "abonnements", durationMs: 600, status: "ok", summary: "Proposition de résiliation à échéance préparée.", evidence: [`subscription:${sub.id}`] });
        const proposal = createCancellationProposal(db, user, sub, "assistant", runId);
        plan.proposalIds.push(proposal.id);
        plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
        plan.finalStatus = "waiting_approval";
      } else {
        plan.blocks.push({ type: "notice", tone: "info", text: "Vous n'avez pas d'abonnement actif pouvant être résilié." });
      }
    }
    return plan;
  }

  // --- Éviter un achat déjà couvert.
  if (user && publication && has(text, "achet", "deja", "repayer", "prendre", "veux")) {
    plan.requestSummary = `Achat envisagé : ${publication.title}.`;
    const editions = db.editions.filter((e) => e.publication_id === publication.id && isPublic(e)).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const number = rawText.match(/\d{1,4}/)?.[0];
    const edition = editions.find((e) => number && e.label.includes(number)) ?? editions[0];
    plan.steps.push({ key: "search", agent: "conseil_editorial", tool: "get_publication", server: "catalogue", durationMs: 700, status: "ok", summary: `Édition identifiée : ${edition?.label ?? "aucune"}.`, evidence: edition ? [`edition:${edition.id}`] : [] });
    const access = edition ? readAccess(db, user, edition) : null;
    plan.steps.push({ key: "access", agent: "offres_abonnements", tool: "check_entitlement", server: "abonnements", durationMs: 900, status: "ok", summary: access ? "Accès déjà actif : achat inutile." : "Pas d'accès actif.", evidence: edition ? [`edition:${edition.id}`] : [] });
    if (edition && access) {
      const via = access === "free" ? "le contenu est gratuit" : access.source === "subscription" ? "votre abonnement" : "un achat précédent";
      plan.blocks.push({ type: "notice", tone: "info", text: `Inutile d'acheter : vous avez déjà accès à « ${publication.title}, ${edition.label} » via ${via}.` });
      plan.blocks.push({ type: "text", markdown: `[Lire maintenant](/lire/${edition.id})` });
      return plan;
    }
    const offer = edition ? db.offers.find((o) => o.scope.kind === "edition" && o.scope.edition_id === edition.id && o.quota === null) : undefined;
    if (offer && eligibility(db, user, offer).can_purchase) {
      plan.steps.push({ key: "prepare", agent: "coordinateur", tool: "prepare_purchase", server: "abonnements", durationMs: 600, status: "ok", summary: "Proposition de commande préparée.", evidence: [`offer:${offer.id}`] });
      const proposal = createPurchaseProposal(db, user, offer, "assistant", runId);
      plan.proposalIds.push(proposal.id);
      plan.blocks.push({ type: "text", markdown: `Vous n'avez pas encore accès à **${publication.title}, ${edition!.label}**. Voici une proposition de commande à confirmer.` });
      plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
      plan.finalStatus = "waiting_approval";
    } else {
      plan.blocks.push({ type: "notice", tone: "warning", text: "Cette édition n'est pas disponible à l'achat pour le moment." });
    }
    return plan;
  }

  // --- Souscription à un abonnement.
  if (has(text, "abonne", "souscri", "abonnement") && !has(text, "compar", "difference", "quel abonnement", "quelle offre")) {
    plan.requestSummary = "Préparer une souscription d'abonnement.";
    if (!universe) {
      plan.blocks.push({ type: "clarification", question: "Quel univers vous intéresse ?", options: ["Abonnement Presse", "Abonnement Business", "Abonnement Culture"] });
      plan.finalStatus = "waiting_user";
      return plan;
    }
    const offer = db.offers.find((o) => o.id === `off_sub_${universe}`)!;
    plan.steps.push({ key: "compare", agent: "offres_abonnements", tool: "get_my_subscriptions", server: "abonnements", durationMs: 1000, status: "ok", summary: "Abonnements existants vérifiés.", evidence: [`offer:${offer.id}`] });
    plan.steps.push({ key: "terms", agent: "conditions_droits", tool: "search_terms", server: "support", durationMs: 800, status: "ok", summary: "Modalités de renouvellement et de résiliation retenues.", evidence: ["terms:vente#renouvellement", "terms:vente#resiliation"] });
    const elig = eligibility(db, user, offer);
    plan.blocks.push({ type: "offer_comparison", rows: subscriptionRows(db, user, universe).filter((r) => r.offer_id.includes(universe)) });
    plan.blocks.push({ type: "citations", items: [citation("vente", "renouvellement"), citation("vente", "resiliation")] });
    if (elig.already_owned) {
      plan.blocks.push({ type: "notice", tone: "info", text: `Vous êtes déjà abonné(e) à l'univers ${UNIVERSE_LABEL[universe]} : aucune nouvelle souscription n'est nécessaire. Vous pouvez la renouveler depuis votre espace.` });
    } else if (elig.can_purchase && user) {
      plan.steps.push({ key: "prepare", agent: "coordinateur", tool: "prepare_purchase", server: "abonnements", durationMs: 600, status: "ok", summary: "Proposition de commande préparée (sans paiement).", evidence: [`offer:${offer.id}`] });
      const proposal = createPurchaseProposal(db, user, offer, "assistant", runId);
      plan.proposalIds.push(proposal.id);
      plan.blocks.push({ type: "proposal", proposal_id: proposal.id });
      plan.finalStatus = "waiting_approval";
    } else if (elig.blocking_reason === "PENDING_ORDER") {
      plan.blocks.push({ type: "notice", tone: "warning", text: "Une commande pour cette offre est déjà en attente de paiement : reprenez-la depuis vos commandes plutôt que d'en créer une nouvelle." });
    }
    return plan;
  }

  // --- Comparaison d'offres.
  if (has(text, "compar", "difference", "quel abonnement", "quelle offre", "prix", "combien", "tarif")) {
    plan.requestSummary = "Comparaison des offres.";
    plan.steps.push({ key: "compare", agent: "offres_abonnements", tool: "compare_offers", server: "catalogue", durationMs: 1000, status: "ok", summary: "Comparaison déterministe des 4 abonnements.", evidence: ["offer:off_sub_presse", "offer:off_sub_business", "offer:off_sub_culture", "offer:off_sub_culture_q"] });
    if (user) plan.steps.push({ key: "access", agent: "offres_abonnements", tool: "get_my_subscriptions", server: "abonnements", durationMs: 700, status: "ok", summary: "Abonnements actifs signalés comme redondants.", evidence: [] });
    plan.blocks.push({
      type: "text",
      markdown: "Voici les abonnements disponibles. Les prix sont calculés par le serveur et **fictifs** en démonstration ; le renouvellement est toujours manuel.",
    });
    plan.blocks.push({ type: "offer_comparison", rows: subscriptionRows(db, user, universe) });
    return plan;
  }

  // --- Conseil de lecture.
  if (has(text, "conseil", "recommand", "idee", "lire", "lecture", "cherche", "suggest", "propose")) {
    plan.requestSummary = `Conseil de lecture${universe ? `, univers ${universe}` : ""}.`;
    const candidates = db.publications
      .filter((p) => (!universe || p.universe === universe) && db.editions.some((e) => e.publication_id === p.id && isPublic(e) && e.availability.state === "available"))
      .sort((a, b) => {
        const la = Math.max(...db.editions.filter((e) => e.publication_id === a.id).map((e) => Date.parse(e.published_at)));
        const lb = Math.max(...db.editions.filter((e) => e.publication_id === b.id).map((e) => Date.parse(e.published_at)));
        return lb - la;
      })
      .slice(0, 3);
    plan.steps.push({ key: "search", agent: "conseil_editorial", tool: "search_publications", server: "catalogue", durationMs: 1100, status: "ok", summary: `${candidates.length} candidats retenus.`, evidence: candidates.map((p) => `publication:${p.id}`) });
    const items = candidates.map((p) => {
      const latest = db.editions.filter((e) => e.publication_id === p.id && isPublic(e)).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]!;
      const access = readAccess(db, user, latest);
      const reason = access === "free" ? "Gratuit." : access ? "Déjà inclus dans vos accès." : "Parution récente.";
      return card(db, p, reason);
    });
    if (user) plan.steps.push({ key: "access", agent: "offres_abonnements", tool: "check_entitlement", server: "abonnements", durationMs: 700, status: "ok", summary: "Accès existants signalés sur les candidats.", evidence: [] });
    plan.blocks.push({ type: "text", markdown: universe ? `Voici trois titres récents de l'univers **${UNIVERSE_LABEL[universe]}** :` : "Voici trois parutions récentes du catalogue :" });
    plan.blocks.push({ type: "publications", items });
    if (!universe) plan.blocks.push({ type: "clarification", question: "Voulez-vous affiner ?", options: ["Plutôt presse", "Plutôt business", "Plutôt culture"] });
    return plan;
  }

  // --- Demande ambiguë : clarification.
  plan.requestSummary = "Demande ambiguë : clarification.";
  plan.blocks.push({
    type: "clarification",
    question: "Je peux vous aider à découvrir des contenus, comparer les offres, comprendre les conditions ou résoudre un problème d'accès. Que souhaitez-vous faire ?",
    options: ["Me conseiller une lecture", "Comparer les abonnements", "J'ai un problème d'accès", "Comment fonctionne la résiliation ?"],
  });
  plan.finalStatus = "waiting_user";
  return plan;
}
