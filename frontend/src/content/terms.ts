/**
 * Conditions de DÉMONSTRATION, PROVISOIRES. Elles n'ont été validées par aucun professionnel
 * et ne constituent pas des conditions contractuelles. Elles servent au corpus de citations de KIA
 * et aux pages d'information.
 */

export const TERMS_VERSION = "démo-0.1";
export const TERMS_EFFECTIVE_DAYS_AGO = 30;

export interface TermsSection {
  id: string;
  title: string;
  body: string;
}

export interface TermsDocument {
  slug: "vente" | "utilisation" | "confidentialite";
  title: string;
  sections: TermsSection[];
}

export const TERMS_DOCUMENTS: TermsDocument[] = [
  {
    slug: "vente",
    title: "Conditions de vente (provisoires)",
    sections: [
      {
        id: "achat-unite",
        title: "Achat à l'unité",
        body: "L'achat à l'unité donne accès à une édition déterminée pendant la durée indiquée sur l'offre au moment de la commande. Le prix affiché est calculé par le serveur et figé dans la commande.",
      },
      {
        id: "abonnement",
        title: "Abonnement thématique",
        body: "Un abonnement thématique donne accès, pendant sa période, aux éditions publiées de l'univers concerné, y compris celles ajoutées pendant la période active. L'abonnement est individuel : il ne peut pas être partagé.",
      },
      {
        id: "renouvellement",
        title: "Renouvellement",
        body: "Le renouvellement est manuel : aucun prélèvement automatique n'est effectué. Le lecteur peut renouveler son abonnement avant ou après l'échéance ; la nouvelle période commence à la fin de la période en cours.",
      },
      {
        id: "resiliation",
        title: "Résiliation",
        body: "La résiliation prend effet à la fin de la période en cours. L'accès est maintenu jusqu'à cette date et l'historique des commandes est conservé.",
      },
      {
        id: "changement-formule",
        title: "Changement de formule",
        body: "Un changement de formule prend effet à la prochaine échéance. Aucun prorata n'est calculé. Le nouveau prix s'applique lors du renouvellement suivant.",
      },
      {
        id: "remboursement",
        title: "Remboursement",
        body: "Les demandes de remboursement sont examinées par un responsable, au cas par cas, via une demande d'assistance. Aucun remboursement n'est décidé automatiquement.",
      },
      {
        id: "retrait",
        title: "Retrait d'un contenu",
        body: "Lorsqu'un éditeur retire un contenu, les nouvelles ventes sont suspendues. L'effet sur les accès déjà acquis dépend du contrat de diffusion et fait l'objet d'une information explicite.",
      },
    ],
  },
  {
    slug: "utilisation",
    title: "Conditions d'utilisation (provisoires)",
    sections: [
      {
        id: "compte",
        title: "Compte lecteur",
        body: "Le compte est personnel. Les achats sont effectués par des personnes majeures.",
      },
      {
        id: "assistant",
        title: "Assistant conversationnel",
        body: "L'assistant aide à découvrir des contenus, comparer des offres et préparer des actions. Il ne réalise aucun paiement, remboursement ou changement de droits sans confirmation explicite, et ses réponses peuvent contenir des erreurs : les informations de la commande et de la bibliothèque font foi.",
      },
      {
        id: "usage",
        title: "Usage des contenus",
        body: "Les contenus sont destinés à un usage personnel. Leur rediffusion n'est pas autorisée.",
      },
    ],
  },
  {
    slug: "confidentialite",
    title: "Politique de confidentialité (provisoire)",
    sections: [
      {
        id: "donnees",
        title: "Données collectées",
        body: "Identité de connexion, préférences utiles, commandes, accès et échanges avec l'assistance. Les durées de conservation proposées (30 jours pour les traces détaillées de l'assistant, 90 jours pour les conversations inactives) restent à valider avant pilote.",
      },
      {
        id: "ia",
        title: "Traitements par l'assistant",
        body: "Les messages envoyés à l'assistant peuvent être transmis à un fournisseur de modèle de langage. Les données personnelles inutiles à la demande ne sont pas transmises.",
      },
      {
        id: "droits",
        title: "Vos demandes",
        body: "Pour exporter ou supprimer vos données, ou pour toute réclamation, utilisez le formulaire d'assistance ou l'adresse de contact indiquée sur le site.",
      },
    ],
  },
];

export function findTermsSection(slug: TermsDocument["slug"], sectionId: string) {
  const doc = TERMS_DOCUMENTS.find((d) => d.slug === slug);
  const section = doc?.sections.find((s) => s.id === sectionId);
  return doc && section ? { doc, section } : null;
}
