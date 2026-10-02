import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { demoPaymentProvider } from "@/mocks/demoApi";

type Outcome = Parameters<typeof demoPaymentProvider.submit>[1];

const OUTCOMES: { value: Outcome; label: string; detail: string; variant: "primary" | "outline" | "danger" }[] = [
  { value: "succeeded", label: "Accepter le paiement", detail: "Notification envoyée en quelques secondes.", variant: "primary" },
  { value: "succeeded_delayed", label: "Accepter, notification retardée", detail: "La confirmation arrive après ~9 s : l'écran reste en vérification.", variant: "outline" },
  { value: "failed", label: "Refuser le paiement", detail: "Carte refusée (simulation).", variant: "outline" },
  { value: "no_response", label: "Ne jamais répondre", detail: "Statut incertain : seule la réconciliation (administration) tranche.", variant: "outline" },
  { value: "cancelled", label: "Annuler et revenir au site", detail: "Le lecteur abandonne le paiement.", variant: "danger" },
];

/**
 * Page du PRESTATAIRE DE TEST (mode démo uniquement). Elle simule un site externe : la plateforme
 * ne reçoit que la notification (simulée) et relit le statut, jamais le paramètre de retour.
 */
export default function TestProviderPage() {
  useDocumentTitle("Prestataire de paiement de test");
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ["demo-provider", sessionId], queryFn: () => demoPaymentProvider.getSession(sessionId) });
  const submit = useMutation({
    mutationFn: (outcome: Outcome) => demoPaymentProvider.submit(sessionId, outcome),
    onSuccess: (result, outcome) => navigate(`${result.return_url}?provider_status=${outcome === "cancelled" ? "cancel" : "success"}`, { replace: true }),
  });

  return (
    <div className="flex flex-1 items-start justify-center bg-[#EEF1F5] px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-[#D5DBE3] bg-white p-6 shadow-lift">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#3B4A63]">
          <FlaskConical className="h-4 w-4" aria-hidden /> TestPay — prestataire simulé
        </p>
        <h1 className="mt-3 font-sans text-2xl font-semibold">Paiement de test</h1>
        <Alert tone="warning" className="mt-4">
          Environnement de TEST : aucune carte n'est demandée, aucune transaction réelle n'est effectuée.
        </Alert>
        {session.isPending ? (
          <div className="mt-6"><LoadingBlock /></div>
        ) : session.isError ? (
          <div className="mt-6"><ErrorState error={session.error} /></div>
        ) : (
          <>
            <dl className="mt-6 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-ink-muted">Marchand</dt><dd className="font-medium">Plateforme de démonstration</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink-muted">Référence</dt><dd className="font-medium">{session.data.reference}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink-muted">Article</dt><dd className="text-right font-medium">{session.data.label}</dd></div>
              <div className="flex justify-between gap-4 border-t pt-2"><dt className="font-semibold">Montant</dt><dd className="text-lg font-semibold">{formatMoney(session.data.total)}</dd></div>
            </dl>
            {session.data.submitted ? (
              <Alert tone="info" className="mt-6">Un résultat a déjà été transmis pour cette session.</Alert>
            ) : (
              <fieldset className="mt-6 space-y-3" disabled={submit.isPending}>
                <legend className="mb-2 text-sm font-medium">Choisissez le résultat à simuler</legend>
                {OUTCOMES.map((o) => (
                  <div key={o.value}>
                    <Button variant={o.variant} className="w-full" onClick={() => submit.mutate(o.value)} loading={submit.isPending && submit.variables === o.value}>
                      {o.label}
                    </Button>
                    <p className="mt-1 text-xs text-ink-subtle">{o.detail}</p>
                  </div>
                ))}
              </fieldset>
            )}
          </>
        )}
      </div>
    </div>
  );
}
