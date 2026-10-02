import { Link } from "react-router-dom";
import { brand } from "@/config/app";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Card, PageHeader } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { useSession } from "@/features/auth/session";
import { assistantPanel } from "@/features/assistant/panelState";

const FAQ: { q: string; a: string; link?: [string, string] }[] = [
  {
    q: "Quelle différence entre un achat à l'unité et un abonnement ?",
    a: "L'achat à l'unité donne accès à une édition précise pendant la durée indiquée sur l'offre. L'abonnement thématique donne accès à toutes les éditions publiées d'un univers (presse, business ou culture) pendant sa période, y compris les nouvelles.",
    link: ["/offres", "Comparer les offres"],
  },
  {
    q: "Mon abonnement se renouvelle-t-il automatiquement ?",
    a: "Non. Le renouvellement est manuel : vous choisissez de renouveler depuis la page de votre abonnement. Aucun prélèvement automatique n'est effectué.",
  },
  {
    q: "Comment résilier ?",
    a: "Depuis la page de l'abonnement, choisissez « Résilier ». Les conséquences sont affichées avant confirmation : l'accès reste ouvert jusqu'à la fin de la période en cours et votre historique est conservé.",
    link: ["/conditions/vente#resiliation", "Conditions de résiliation (provisoires)"],
  },
  {
    q: "Je n'arrive pas à ouvrir un contenu.",
    a: "Vérifiez d'abord dans votre bibliothèque que l'accès est actif et non expiré. Le lien vers le fichier est régénéré à chaque ouverture. Si le problème persiste, ouvrez une demande d'assistance.",
    link: ["/compte/assistance/nouvelle", "Ouvrir une demande"],
  },
  {
    q: "Mon paiement est « en cours de vérification ».",
    a: "Le retour depuis la page de paiement ne suffit pas à confirmer un paiement : nous attendons la confirmation du prestataire. Ne payez pas une seconde fois ; la commande se met à jour dès que le statut est connu.",
  },
  {
    q: `Que fait l'assistant ${brand.assistantName} ?`,
    a: `${brand.assistantName} vous aide à trouver une lecture, comparer les offres, comprendre les conditions ou diagnostiquer un problème d'accès. Il prépare des propositions, mais rien n'est exécuté sans votre confirmation, et aucun paiement n'est effectué par l'assistant.`,
  },
];

export default function InfoPages({ page }: { page: "help" | "about" | "contact" }) {
  if (page === "about") return <AboutPage />;
  if (page === "contact") return <ContactPage />;
  return <HelpPage />;
}

function HelpPage() {
  useDocumentTitle(`Aide · ${brand.name}`);
  return (
    <div className="container max-w-3xl py-10">
      <PageHeader title="Aide" description="Les réponses aux questions les plus fréquentes." />
      <div className="divide-y divide-line rounded-card border border-line bg-surface">
        {FAQ.map((item) => (
          <details key={item.q} className="group p-5">
            <summary className="cursor-pointer list-none font-medium marker:hidden">
              <span className="flex items-start justify-between gap-4">
                {item.q}
                <span className="text-brand transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 leading-7 text-ink-muted">{item.a}</p>
            {item.link && (
              <Link to={item.link[0]} className="mt-2 inline-block font-medium text-brand underline underline-offset-2">
                {item.link[1]}
              </Link>
            )}
          </details>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={() => assistantPanel.open()}>Demander à {brand.assistantName}</Button>
        <ButtonLink to="/contact" variant="outline">
          Contacter l'assistance
        </ButtonLink>
      </div>
    </div>
  );
}

function AboutPage() {
  useDocumentTitle(`À propos · ${brand.name}`);
  return (
    <div className="container max-w-3xl py-10">
      <PageHeader title={`À propos de ${brand.name}`} />
      <div className="kiosy-prose">
        <p>
          {brand.name} réunit des contenus numériques de plusieurs éditeurs — presse, business et culture — dans un catalogue unique, avec une bibliothèque personnelle et un assistant d'aide.
        </p>
        <p>Le service s'adresse aux lecteurs à Madagascar, à la diaspora et plus largement aux lecteurs francophones.</p>
        <h2>Nos engagements de conception</h2>
        <ul>
          <li>Afficher avant tout achat ce qui est inclus, pour combien de temps et à quel prix.</li>
          <li>Signaler un contenu que vous possédez déjà pour éviter un achat inutile.</li>
          <li>Ne jamais exécuter de paiement ou de changement sans votre confirmation explicite.</li>
          <li>Permettre toutes les actions essentielles sans passer par l'assistant.</li>
        </ul>
        <h2>Statut du projet</h2>
        <p>
          Cette version est une réalisation en cours de validation. Les éditeurs, contenus et prix présentés en démonstration sont fictifs. Le lancement commercial dépend de droits éditoriaux documentés, d'un prestataire de paiement et de conditions contractuelles validées.
        </p>
      </div>
    </div>
  );
}

function ContactPage() {
  useDocumentTitle(`Contact · ${brand.name}`);
  const { user } = useSession();
  return (
    <div className="container max-w-3xl py-10">
      <PageHeader title="Contact et assistance" description="Une question sur un accès, une commande ou un abonnement ?" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-serif text-xl font-semibold">Demande d'assistance</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            La demande est rattachée à votre compte, ce qui permet à l'équipe de vérifier vos accès sans vous redemander vos informations.
          </p>
          <div className="mt-4">
            {user ? (
              <ButtonLink to="/compte/assistance/nouvelle">Ouvrir une demande</ButtonLink>
            ) : (
              <ButtonLink to={`/connexion?retour=${encodeURIComponent("/compte/assistance/nouvelle")}`}>Se connecter pour ouvrir une demande</ButtonLink>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-serif text-xl font-semibold">Autres demandes</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Données personnelles, réclamations, partenariats éditeurs :</p>
          <p className="mt-3 font-medium">{brand.contactEmail}</p>
          <Alert tone="warning" className="mt-4">
            Adresse provisoire, à définir avant le pilote : elle ne reçoit pas encore de messages.
          </Alert>
        </Card>
      </div>
    </div>
  );
}
