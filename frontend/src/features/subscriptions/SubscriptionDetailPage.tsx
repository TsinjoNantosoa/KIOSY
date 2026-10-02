import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw, Replace, XCircle } from "lucide-react";
import { brand } from "@/config/app";
import type { Subscription } from "@/contracts/models";
import { SUBSCRIPTION_GIVES_ACCESS } from "@/contracts/rules";
import { SubscriptionStatusBadge } from "@/components/StatusBadges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { Card, CardTitle, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { formatDate, formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";
import { ProposalCard } from "@/features/proposals/ProposalCard";

export default function SubscriptionDetailPage() {
  const { subscriptionId = "" } = useParams();
  const uid = useUid();
  const tz = useTimeZone();
  const sub = useQuery({ queryKey: qk.subscription(uid, subscriptionId), queryFn: ({ signal }) => api.me.subscription(subscriptionId, { signal }) });
  useDocumentTitle(`${sub.data?.offer.title ?? "Abonnement"} · ${brand.name}`);

  if (sub.isPending) return <LoadingBlock lines={8} />;
  if (sub.isError) return <ErrorState error={sub.error} onRetry={() => sub.refetch()} />;
  const s = sub.data;
  const gives = SUBSCRIPTION_GIVES_ACCESS[s.status];

  return (
    <div className="space-y-6">
      <PageHeader title={s.offer.title} back={{ to: "/compte/abonnements", label: "Mes abonnements" }} actions={<SubscriptionStatusBadge status={s.status} />} />
      {s.status === "cancel_at_period_end" && (
        <Alert tone="warning" title="Résiliation enregistrée">
          Votre accès reste ouvert jusqu'au {formatDate(s.current_period_end, tz)}. Vous pouvez encore renouveler manuellement pour prolonger.
        </Alert>
      )}
      {s.status === "expired" && (
        <Alert tone="info" title="Abonnement expiré">
          La période est terminée depuis le {formatDate(s.current_period_end, tz)}. Renouvelez-le pour retrouver l'accès aux éditions de l'univers.
        </Alert>
      )}
      <Card>
        <CardTitle>Détails</CardTitle>
        <DefinitionList
          items={[
            { term: "Contenu inclus", value: `${s.scope_label}, y compris les éditions publiées pendant la période` },
            { term: "Période en cours", value: `Du ${formatDate(s.current_period_start, tz)} au ${formatDate(s.current_period_end, tz)}` },
            { term: "Prix de la formule", value: `${formatMoney(s.offer.price)} pour ${formatDuration(s.offer.duration)} (tarif de votre commande, version ${s.offer.offer_version})` },
            { term: "Renouvellement", value: "Manuel : aucun prélèvement automatique" },
            { term: "Conditions", value: `Version ${s.offer.conditions_version}` },
            ...(s.scheduled_change ? [{ term: "Changement programmé", value: `${s.scheduled_change.target_offer_title} à partir du ${formatDate(s.scheduled_change.effective_at, tz)}` }] : []),
          ]}
        />
      </Card>

      <Card>
        <CardTitle>Actions</CardTitle>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
          <div className="rounded-md border border-line p-4">
            <h3 className="flex items-center gap-2 font-sans font-semibold"><RefreshCw className="h-4 w-4" aria-hidden /> Renouveler</h3>
            <p className="mt-1 text-sm text-ink-muted">Ajoute une période après l'échéance actuelle. Le mode de paiement sera celui indiqué par le prestataire configuré.</p>
            <ButtonLink to={`/commande?offre=${s.offer.offer_id}&renouvellement=${s.id}`} size="sm" className="mt-3">Renouveler manuellement</ButtonLink>
          </div>
          <PlanChange subscription={s} disabled={!gives} />
          <Cancellation subscription={s} disabled={s.status !== "active"} />
        </div>
      </Card>

      <Card>
        <CardTitle>Historique</CardTitle>
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {[...s.history].reverse().map((h, i) => (
            <li key={i}>
              <p className="text-sm">{h.label}</p>
              <p className="text-xs text-ink-subtle">{formatDateTime(h.at, tz)}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Cancellation({ subscription, disabled }: { subscription: Subscription; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const prepare = useMutation({ mutationFn: () => api.proposals.prepareCancellation(subscription.id) });
  const start = () => {
    setOpen(true);
    prepare.mutate();
  };
  return (
    <div className="rounded-md border border-line p-4">
      <h3 className="flex items-center gap-2 font-sans font-semibold"><XCircle className="h-4 w-4" aria-hidden /> Résilier</h3>
      <p className="mt-1 text-sm text-ink-muted">Fin à l'échéance : l'accès est maintenu jusqu'à la fin de la période.</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={start} disabled={disabled}>
        Préparer la résiliation
      </Button>
      {disabled && <p className="mt-2 text-xs text-ink-subtle">Disponible uniquement pour un abonnement actif.</p>}
      <Dialog open={open} onOpenChange={setOpen} title="Résilier l'abonnement" description="Vérifiez les conséquences avant de confirmer.">
        {prepare.isPending ? <LoadingBlock /> : prepare.isError ? <InlineError error={prepare.error} /> : prepare.data ? (
          <ProposalCard key={prepare.data.id} proposalId={prepare.data.id} onRenew={() => prepare.mutate()} />
        ) : null}
      </Dialog>
    </div>
  );
}

function PlanChange({ subscription, disabled }: { subscription: Subscription; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const offers = useQuery({ queryKey: qk.offers({}), queryFn: ({ signal }) => api.offers.list({}, { signal }), enabled: open });
  const candidates = (offers.data ?? []).filter((o) => o.kind === "subscription" && o.id !== subscription.offer.offer_id && o.status === "active");
  const prepare = useMutation({ mutationFn: (offerId: string) => api.proposals.preparePlanChange(subscription.id, offerId) });
  return (
    <div className="rounded-md border border-line p-4">
      <h3 className="flex items-center gap-2 font-sans font-semibold"><Replace className="h-4 w-4" aria-hidden /> Changer de formule</h3>
      <p className="mt-1 text-sm text-ink-muted">Effet à la prochaine échéance, sans prorata.</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)} disabled={disabled}>
        Simuler un changement
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) prepare.reset(); }} title="Changer de formule" description="La simulation est calculée par le serveur.">
        {!prepare.data ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) prepare.mutate(target);
            }}
          >
            <div>
              <label htmlFor="target-offer" className="mb-1.5 block text-sm font-medium">Nouvelle formule</label>
              <Select id="target-offer" value={target} onChange={(e) => setTarget(e.target.value)} required>
                <option value="">Choisir…</option>
                {candidates.map((o) => <option key={o.id} value={o.id}>{o.title} — {formatMoney(o.price)} / {formatDuration(o.duration)}</option>)}
              </Select>
            </div>
            {prepare.error && <InlineError error={prepare.error} />}
            <Button type="submit" loading={prepare.isPending} disabled={!target}>Voir les conséquences</Button>
          </form>
        ) : (
          <ProposalCard key={prepare.data.id} proposalId={prepare.data.id} onRenew={() => target && prepare.mutate(target)} />
        )}
      </Dialog>
    </div>
  );
}
