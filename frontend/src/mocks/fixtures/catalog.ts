import type { ContentFormat, CoverSpec, Universe } from "@/contracts/models";

/**
 * Catalogue de DÉMONSTRATION. Publications, éditeurs, auteurs et textes sont fictifs et
 * rédigés pour ce projet. Aucun contenu n'est repris d'un site ou d'une publication réelle.
 */

export const DEMO_PUBLISHERS = [
  { id: "pub_lohasaha", name: "Éditions Lohasaha (fictif)", is_demo: true },
  { id: "pub_antsiva", name: "Maison Antsiva (fictif)", is_demo: true },
] as const;

export interface EditionFixture {
  id: string;
  label: string;
  daysAgo: number;
  /** Prix unitaire en ariary (MGA, scale 0). null = pas de vente à l'unité. */
  price: number | null;
  free?: boolean;
  status?: "draft" | "review" | "published" | "suspended" | "archived";
  rightsExpired?: boolean;
  pages?: number;
}

export interface PublicationFixture {
  id: string;
  slug: string;
  title: string;
  author: string;
  publisherId: (typeof DEMO_PUBLISHERS)[number]["id"];
  universe: Universe;
  format: ContentFormat;
  kind: "series" | "work";
  summary: string;
  tags: string[];
  cover: CoverSpec;
  editions: EditionFixture[];
  /** Corps de texte de démonstration (Markdown simple). */
  body: string;
}

export const DEMO_PUBLICATIONS: PublicationFixture[] = [
  {
    id: "p01",
    slug: "echo-du-matin",
    title: "L'Écho du Matin",
    author: "Rédaction de L'Écho (fictif)",
    publisherId: "pub_lohasaha",
    universe: "presse",
    format: "text",
    kind: "series",
    summary: "Un quotidien fictif qui résume en dix minutes l'actualité nationale, régionale et internationale.",
    tags: ["actualité", "quotidien", "société"],
    cover: { palette: ["#F4EFE3", "#1B2230", "#B4532A"], motif: "columns", kicker: "Quotidien" },
    editions: [
      { id: "e01a", label: "Édition du jour", daysAgo: 1, price: 1500 },
      { id: "e01b", label: "Édition de la semaine passée", daysAgo: 8, price: 1500 },
      { id: "e01c", label: "Édition d'il y a deux semaines", daysAgo: 15, price: 1500 },
    ],
    body: `## À la une

La saison des pluies approche et les communes préparent leurs plans d'entretien des canaux. Dans plusieurs quartiers, des comités de voisinage organisent des journées de nettoyage, avec le soutien des services techniques.

## Société

Les bibliothèques municipales élargissent leurs horaires d'ouverture le samedi. L'objectif annoncé est simple : offrir un lieu calme aux lycéens qui préparent leurs examens.

## Économie

Les petits commerçants témoignent d'une reprise prudente de la fréquentation des marchés. Beaucoup misent sur le paiement mobile pour fluidifier les échanges.

## Le mot de la rédaction

Ce numéro est un contenu de démonstration fictif. Il sert à vérifier la lecture, la mise en page et les droits d'accès de la plateforme.`,
  },
  {
    id: "p02",
    slug: "hebdo-ocean-indien",
    title: "Hebdo Océan Indien",
    author: "Collectif de journalistes (fictif)",
    publisherId: "pub_antsiva",
    universe: "presse",
    format: "pdf",
    kind: "series",
    summary: "L'hebdomadaire fictif des îles de l'océan Indien : politique, environnement et vie quotidienne.",
    tags: ["hebdomadaire", "région", "environnement"],
    cover: { palette: ["#1F3A5F", "#F4EFE3", "#E0B04B"], motif: "waves", kicker: "Hebdo" },
    editions: [
      { id: "e02a", label: "N° 214", daysAgo: 3, price: 3000, pages: 3 },
      { id: "e02b", label: "N° 213", daysAgo: 10, price: 3000, pages: 3 },
    ],
    body: `## Dossier : la mer en partage

Pêcheurs artisanaux, chercheurs et collectivités se retrouvent autour d'une même question : comment préserver les ressources côtières tout en maintenant les revenus des familles ?

## Portrait

Une enseignante de sciences a créé un club d'observation des récifs. Chaque mois, ses élèves consignent la température de l'eau et l'état des coraux dans un carnet partagé.

## Agenda

Festival du film documentaire, marché des producteurs, conférence sur les mangroves : la sélection de la rédaction pour les semaines à venir.

Document de démonstration fictif, généré pour tester la consultation des fichiers PDF.`,
  },
  {
    id: "p03",
    slug: "cahiers-de-la-region",
    title: "Cahiers de la Région",
    author: "Observatoire régional (fictif)",
    publisherId: "pub_lohasaha",
    universe: "presse",
    format: "pdf",
    kind: "series",
    summary: "Un mensuel fictif d'analyse territoriale : infrastructures, éducation et initiatives locales.",
    tags: ["mensuel", "territoires", "analyse"],
    cover: { palette: ["#E3EFE9", "#173F34", "#B4532A"], motif: "grid", kicker: "Mensuel" },
    editions: [{ id: "e03a", label: "Septembre 2026", daysAgo: 6, price: 4000, pages: 3 }],
    body: `## Routes et désenclavement

Le numéro revient sur trois chantiers de pistes rurales et sur leurs effets attendus : accès aux centres de santé, acheminement des récoltes, fréquentation scolaire.

## Éducation

Des établissements testent un calendrier aménagé pendant la saison des pluies. Les premiers retours des familles sont partagés, avec leurs réserves.

## Méthode

Les chiffres cités dans ce numéro de démonstration sont fictifs et ne doivent pas être utilisés comme données réelles.`,
  },
  {
    id: "p04",
    slug: "petit-journal-des-sciences",
    title: "Le Petit Journal des Sciences",
    author: "Association Curiosité (fictif)",
    publisherId: "pub_antsiva",
    universe: "presse",
    format: "text",
    kind: "series",
    summary: "Des articles courts et accessibles pour comprendre la science du quotidien.",
    tags: ["sciences", "vulgarisation", "jeunesse"],
    cover: { palette: ["#FFF4D6", "#1B2230", "#1F5D4C"], motif: "rings", kicker: "Sciences" },
    editions: [
      { id: "e04a", label: "N° 7 — L'eau", daysAgo: 4, price: null, free: true },
      { id: "e04b", label: "N° 6 — Le ciel", daysAgo: 34, price: 1000 },
    ],
    body: `## Pourquoi l'eau bout-elle plus vite en altitude ?

Plus on monte, plus la pression de l'air diminue. L'eau a alors besoin de moins d'énergie pour passer à l'état de vapeur : elle bout à une température plus basse.

## L'expérience du mois

Remplissez deux verres identiques, l'un d'eau froide, l'autre d'eau tiède. Déposez une goutte de colorant alimentaire dans chacun et observez : la diffusion est plus rapide dans l'eau tiède.

## Le saviez-vous ?

Une grande partie de l'eau douce de la planète est stockée sous forme de glace ou dans les nappes souterraines.

Article de démonstration fictif.`,
  },
  {
    id: "p05",
    slug: "chroniques-urbaines",
    title: "Chroniques urbaines",
    author: "Lalao Ranaivo (autrice fictive)",
    publisherId: "pub_lohasaha",
    universe: "presse",
    format: "text",
    kind: "work",
    summary: "Un recueil de chroniques fictives sur la ville, ses marchés, ses transports et ses habitants.",
    tags: ["chroniques", "ville", "société"],
    cover: { palette: ["#2B2D42", "#F4EFE3", "#EF8354"], motif: "bars", kicker: "Chroniques" },
    editions: [
      { id: "e05a", label: "Édition 2026", daysAgo: 20, price: 2500 },
      { id: "e05b", label: "Édition augmentée (en préparation)", daysAgo: 0, price: 3000, status: "review" },
    ],
    body: `## Le premier bus

Il part avant l'aube. Le chauffeur connaît chaque passager par son prénom et sait qui descendra devant l'hôpital, qui devant le lycée.

## Le marché du samedi

On y vend des légumes, des outils, des cassettes d'un autre temps. On y échange surtout des nouvelles.

## La pluie

Quand elle arrive, la ville ralentit. Les auvents se remplissent, les conversations aussi.

Chroniques fictives de démonstration.`,
  },
  {
    id: "p06",
    slug: "trimestriel-de-l-entreprise",
    title: "Le Trimestriel de l'Entreprise",
    author: "Cercle des dirigeants (fictif)",
    publisherId: "pub_antsiva",
    universe: "business",
    format: "pdf",
    kind: "series",
    summary: "Analyses, études de cas et outils de gestion pour les dirigeants de PME.",
    tags: ["gestion", "PME", "stratégie"],
    cover: { palette: ["#173F34", "#F4EFE3", "#E0B04B"], motif: "bars", kicker: "Trimestriel" },
    editions: [
      { id: "e06a", label: "N° 12", daysAgo: 25, price: 9000, pages: 4 },
      { id: "e06b", label: "N° 11", daysAgo: 115, price: 9000, pages: 4 },
    ],
    body: `## Étude de cas : structurer sa trésorerie

Une entreprise de transformation alimentaire fictive a mis en place un tableau de trésorerie hebdomadaire. Résultat : moins de découverts et des négociations fournisseurs mieux préparées.

## Outil : la matrice des priorités

Classer les projets selon leur impact et leur effort permet de clarifier les arbitrages en comité de direction.

## Point de vue

Recruter un premier cadre financier est une étape délicate. Trois dirigeants fictifs partagent leurs critères.

Numéro de démonstration fictif ; les chiffres cités sont illustratifs.`,
  },
  {
    id: "p07",
    slug: "marches-et-filieres",
    title: "Marchés & Filières",
    author: "Rédaction économique (fictif)",
    publisherId: "pub_lohasaha",
    universe: "business",
    format: "text",
    kind: "series",
    summary: "Le suivi mensuel fictif des prix, des filières d'exportation et des chaînes d'approvisionnement.",
    tags: ["filières", "prix", "export"],
    cover: { palette: ["#E0B04B", "#1B2230", "#173F34"], motif: "grid", kicker: "Mensuel éco" },
    editions: [{ id: "e07a", label: "Octobre 2026", daysAgo: 2, price: 5000 }],
    body: `## Tendances du mois

Les coûts logistiques restent le premier sujet de préoccupation des exportateurs interrogés. Plusieurs mutualisent désormais leurs conteneurs.

## Filière textile

Les ateliers diversifient leurs clients pour réduire leur dépendance à un seul donneur d'ordres.

## Méthode

Les séries de prix présentées dans cette édition de démonstration sont fictives.`,
  },
  {
    id: "p08",
    slug: "guide-micro-entreprise",
    title: "Guide pratique de la micro-entreprise",
    author: "Hanitra Rasoa (autrice fictive)",
    publisherId: "pub_antsiva",
    universe: "business",
    format: "pdf",
    kind: "work",
    summary: "Un guide pas à pas pour lancer et piloter une petite activité : formalités, prix, trésorerie.",
    tags: ["entrepreneuriat", "guide", "trésorerie"],
    cover: { palette: ["#F6E6DA", "#1B2230", "#B4532A"], motif: "columns", kicker: "Guide" },
    editions: [{ id: "e08a", label: "Édition 2026", daysAgo: 60, price: 7500, pages: 4 }],
    body: `## Fixer son prix

Additionnez vos coûts directs, une part de vos frais fixes et la rémunération de votre temps. Comparez ensuite avec les prix observés autour de vous.

## Tenir un cahier de caisse

Une ligne par opération, la date, le montant, le motif. Ce geste simple évite bien des surprises en fin de mois.

## Se faire accompagner

Chambres consulaires, associations et réseaux d'entrepreneurs proposent souvent des permanences gratuites.

Guide de démonstration fictif ; il ne constitue pas un conseil juridique ou fiscal.`,
  },
  {
    id: "p09",
    slug: "lettre-de-l-export",
    title: "Lettre de l'export",
    author: "Club des exportateurs (fictif)",
    publisherId: "pub_lohasaha",
    universe: "business",
    format: "text",
    kind: "series",
    summary: "Une lettre fictive de veille sur les marchés extérieurs, les salons et la logistique.",
    tags: ["export", "veille", "logistique"],
    cover: { palette: ["#1F5D4C", "#F4EFE3", "#E0B04B"], motif: "waves", kicker: "Veille" },
    editions: [{ id: "e09a", label: "Lettre n° 48", daysAgo: 9, price: 3500 }],
    body: `## Salons à venir

Trois salons régionaux ouvrent leurs inscriptions. La lettre détaille les dates limites et les frais de participation (fictifs).

## Logistique

Le regroupement des envois réduit les coûts, mais demande une planification plus rigoureuse.

Lettre de démonstration fictive.`,
  },
  {
    id: "p10",
    slug: "finance-au-quotidien",
    title: "Finance au quotidien",
    author: "Collectif Budget (fictif)",
    publisherId: "pub_antsiva",
    universe: "business",
    format: "text",
    kind: "series",
    summary: "Chroniques de finances personnelles. Droits de diffusion expirés : publication indisponible à la vente.",
    tags: ["budget", "épargne"],
    cover: { palette: ["#D9D4C7", "#4A5263", "#1B2230"], motif: "rings", kicker: "Budget" },
    editions: [{ id: "e10a", label: "N° 3", daysAgo: 200, price: 2000, rightsExpired: true }],
    body: `## Épargner un peu, régulièrement

Contenu de démonstration dont les droits de diffusion fictifs ont expiré.`,
  },
  {
    id: "p11",
    slug: "revue-des-arts-vivants",
    title: "Revue des Arts Vivants",
    author: "Comité de rédaction (fictif)",
    publisherId: "pub_lohasaha",
    universe: "culture",
    format: "pdf",
    kind: "series",
    summary: "Théâtre, danse, musique : une revue fictive consacrée aux scènes et à celles et ceux qui les font vivre.",
    tags: ["théâtre", "danse", "scène"],
    cover: { palette: ["#7A1F2B", "#F4EFE3", "#E0B04B"], motif: "arcs", kicker: "Revue" },
    editions: [{ id: "e11a", label: "N° 31", daysAgo: 12, price: 6000, pages: 3 }],
    body: `## Entretien

Une metteuse en scène fictive raconte la création d'un spectacle joué dans des cours d'école, au plus près du public.

## Répertoire

Retour sur les pièces qui ont marqué la saison, avec les regards croisés de trois critiques.

## Transmission

Des ateliers de danse traditionnelle accueillent chaque semaine des enfants et leurs grands-parents.

Revue de démonstration fictive.`,
  },
  {
    id: "p12",
    slug: "contes-de-la-cote-est",
    title: "Contes de la côte Est",
    author: "Recueillis par Faly Randria (fictif)",
    publisherId: "pub_antsiva",
    universe: "culture",
    format: "text",
    kind: "work",
    summary: "Un recueil gratuit de contes originaux écrits pour la démonstration, à lire en famille.",
    tags: ["contes", "famille", "gratuit"],
    cover: { palette: ["#E3EFE9", "#1B2230", "#B4532A"], motif: "waves", kicker: "Contes" },
    editions: [{ id: "e12a", label: "Recueil", daysAgo: 40, price: null, free: true }],
    body: `## Le pêcheur et la lune

Chaque soir, un vieux pêcheur posait une question à la lune. Chaque soir, la lune répondait par un reflet différent sur l'eau. Un jour, sa petite-fille comprit que les réponses se lisaient dans les vagues.

## La pirogue trop pressée

Une pirogue voulait arriver avant toutes les autres. Elle partit sans attendre la marée et resta posée sur le sable jusqu'au soir, à écouter les autres rire en passant.

## Morale

Ces contes sont des textes originaux fictifs, écrits pour la démonstration.`,
  },
  {
    id: "p13",
    slug: "cinema-et-ecrans",
    title: "Cinéma & Écrans",
    author: "Ciné-club fictif",
    publisherId: "pub_lohasaha",
    universe: "culture",
    format: "text",
    kind: "series",
    summary: "Critiques, entretiens et programmation des salles et festivals (tous fictifs).",
    tags: ["cinéma", "critique", "festival"],
    cover: { palette: ["#1B2230", "#F4EFE3", "#EF8354"], motif: "columns", kicker: "Cinéma" },
    editions: [{ id: "e13a", label: "Septembre 2026", daysAgo: 5, price: 2000 }],
    body: `## Critique

Un premier long métrage fictif suit trois générations d'une même famille le temps d'un mariage. La mise en scène, sobre, laisse la place aux silences.

## Festival

La programmation du festival de courts métrages met en avant les jeunes réalisatrices.

Contenu de démonstration fictif.`,
  },
  {
    id: "p14",
    slug: "musiques-d-ici",
    title: "Musiques d'ici",
    author: "Rédaction musicale (fictif)",
    publisherId: "pub_antsiva",
    universe: "culture",
    format: "text",
    kind: "series",
    summary: "Portraits d'artistes, histoire des instruments et sélection d'albums (fictifs).",
    tags: ["musique", "portraits", "instruments"],
    cover: { palette: ["#E0B04B", "#1B2230", "#7A1F2B"], motif: "rings", kicker: "Musique" },
    editions: [{ id: "e14a", label: "N° 19", daysAgo: 18, price: 2000 }],
    body: `## Portrait

Un luthier fictif fabrique des instruments à cordes à partir de bois récupérés. Il explique comment le choix de l'essence change le timbre.

## Écoute

Cinq albums imaginaires pour découvrir la diversité des musiques de l'île.

Contenu de démonstration fictif.`,
  },
  {
    id: "p15",
    slug: "carnets-hautes-terres",
    title: "Carnets de voyage : les Hautes Terres",
    author: "Tojo Andria (auteur fictif)",
    publisherId: "pub_lohasaha",
    universe: "culture",
    format: "pdf",
    kind: "work",
    summary: "Un carnet de voyage illustré fictif, entre rizières, marchés et villages d'altitude.",
    tags: ["voyage", "récit", "paysages"],
    cover: { palette: ["#3E6B48", "#F4EFE3", "#E0B04B"], motif: "arcs", kicker: "Voyage" },
    editions: [{ id: "e15a", label: "Édition illustrée", daysAgo: 70, price: 8000, pages: 3 }],
    body: `## Premier jour

Le chemin monte doucement entre les rizières en terrasses. Au loin, les maisons de briques rouges se découpent sur le ciel.

## Le marché

On y trouve des paniers tressés, des fruits de saison et des conversations qui ne finissent jamais.

Récit de démonstration fictif.`,
  },
  {
    id: "p16",
    slug: "anthologie-poesie-contemporaine",
    title: "Anthologie de la poésie contemporaine",
    author: "Choix de textes originaux (fictif)",
    publisherId: "pub_antsiva",
    universe: "culture",
    format: "text",
    kind: "work",
    summary: "Une anthologie de poèmes originaux écrits pour la démonstration.",
    tags: ["poésie", "anthologie"],
    cover: { palette: ["#F4EFE3", "#7A1F2B", "#1F5D4C"], motif: "grid", kicker: "Poésie" },
    editions: [{ id: "e16a", label: "Volume 1", daysAgo: 90, price: 4500 }],
    body: `## Matin

La brume se lève
sur les toits de tôle —
un coq, puis la ville.

## Retour

Le train du soir
emporte nos phrases
jusqu'au prochain quai.

Poèmes originaux fictifs de démonstration.`,
  },
];

/** Offres d'abonnement thématique : renouvellement manuel uniquement (SUB04). */
export const DEMO_SUBSCRIPTION_OFFERS = [
  { id: "off_sub_presse", universe: "presse", title: "Abonnement Presse — mensuel", price: 15000, months: 1 },
  { id: "off_sub_business", universe: "business", title: "Abonnement Business — mensuel", price: 25000, months: 1 },
  { id: "off_sub_culture", universe: "culture", title: "Abonnement Culture — mensuel", price: 12000, months: 1 },
  { id: "off_sub_culture_q", universe: "culture", title: "Abonnement Culture — trimestriel", price: 32000, months: 3 },
] as const;

/** Durée d'accès d'un achat à l'unité : hypothèse de démonstration, configurable (docs/HYPOTHESES.md). */
export const SINGLE_PURCHASE_ACCESS_MONTHS = 12;
