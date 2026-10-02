import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, XCircle } from "lucide-react";
import { isApiError } from "@/contracts/errors";
import type { ActionProposal } from "@/contracts/models";
import { ProposalStatusBadge } from "@/components/StatusBadges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatCountdown, formatMoney } from "@/lib/format";
import { useCountdown } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";

/**
 * Proposition d'action préparée par le serveur (section 7, SAFE01-02, UX03).
 * La confirmation transmet l'IDENTIFIANT de proposition avec une clé d'idempotence ; le serveur
 * revalide prix, version, droits et échéance. Aucun booléen « approved » local n'a de valeur.
 */
export function ProposalCard({
  proposalId,
  onRenew,
  renewLabel = "Préparer une nouvelle proposition",
  compact = false,
  onDecided,
}: {
  proposalId: string;
  onRenew?: () => void;
  renewLabel?: string;
  compact?: boolean;
  onDecided?: (proposal: ActionProposal) => void;
}) {
  const uid = useUid();
  const client = useQueryClient();
  const proposal = useQuery({ queryKey: qk.proposal(uid, proposalId), queryFn: ({ signal }) => api.proposals.get(proposalId, { signal }) });
  const confirmKey = useIdempotencyKey();
  const rejectKey = useIdempotencyKey();
  const remaining = useCountdown(proposal.data?.status === "pending" ? proposal.data.expires_at : null);

  const afterDecision = (updated: ActionProposal) => {
    client.setQueryData(qk.proposal(uid, proposalId), updated);
    client.invalidateQueries({ queryKey: qk.me(uid), predicate: (q) => q.queryKey[2] !== "proposal" });
    onDecided?.(updated);
  };

  const confirm = useMutation({
    mutationFn: () => api.proposals.confirm(proposalId, { idempotencyKey: confirmKey.keyFor({ proposalId, action: "confirm" }) }),
    onSuccess: afterDecision,
    onError: (error) => {
      if (isApiError(error) && error.kind === "conflict") client.invalidateQueries({ queryKey: qk.proposal(uid, proposalId) });
    },
  });
  const reject = useMutation({
    mutationFn: () => api.proposals.reject(proposalId, { idempotencyKey: rejectKey.keyFor({ proposalId, action: "reject" }) }),
    onSuccess: afterDecision,
  });

  if (proposal.isPending) return <LoadingBlock lines={3} />;
  if (proposal.isError) return <InlineError error={proposal.error} />;
  const p = proposal.data;
  const code = isApiError(confirm.error) ? confirm.error.code : null;
  const expiredLocally = p.status === "pending" && remaining === 0;
  const stale = code === "PROPOSAL_EXPIRED" || code === "PROPOSAL_STALE" || p.status === "expired" || p.status === "superseded";
  const busy = confirm.isPending || reject.isPending;

  const kind =
    p.status === "confirmed"
      ? { label: t.assistant.kinds.done, icon: CheckCircle2, cls: "border-brand/40 bg-brand-soft/60" }
      : p.status === "pending"
        ? { label: `${t.assistant.kinds.prepared} · ${t.assistant.kinds.waiting}`, icon: ClipboardList, cls: "border-caution/40 bg-caution-soft/50" }
        : p.status === "rejected"
          ? { label: "Proposition refusée", icon: XCircle, cls: "border-line bg-sunken" }
          : { label: t.assistant.kinds.failed, icon: AlertTriangle, cls: "border-line bg-sunken" };
  const Icon = kind.icon;

  return (
    <section className={cn("rounded-card border p-4", kind.cls)} aria-label={`Proposition : ${p.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Icon className="h-4 w-4" aria-hidden />
          {kind.label}
        </p>
        <ProposalStatusBadge status={p.status} />
      </div>
      <h3 className="mt-2 font-sans text-base font-semibold text-ink">{p.title}</h3>
      <p className="text-sm text-ink-muted">Concerne : {p.resource.label}</p>

      {!compact || p.status === "pending" ? (
        <>
          <h4 className="mt-3 text-sm font-semibold">Conséquences</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {p.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : null}
      {p.amount && (
        <p className="mt-3 text-sm">
          Montant : <strong>{formatMoney(p.amount)}</strong>
          {p.type === "purchase" && <span className="text-ink-muted"> — payé uniquement à l'étape suivante, chez le prestataire.</span>}
          {p.type === "change_plan" && <span className="text-ink-muted"> — au prochain renouvellement manuel.</span>}
        </p>
      )}
      {p.conditions_version && (
        <p className="mt-1 text-sm">
          Conditions applicables : <Link to="/conditions/vente" className="text-brand underline" target="_blank">version {p.conditions_version}</Link>
        </p>
      )}

      {p.status === "pending" && !stale && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-muted" role="timer" aria-live="off">
          <Clock className="h-4 w-4" aria-hidden />
          {expiredLocally ? "Échéance atteinte : la confirmation sera refusée par le serveur." : <>Valable encore {remaining !== null ? formatCountdown(remaining) : "…"}</>}
        </p>
      )}

      {p.status === "confirmed" && p.result && (
        <Alert tone="success" className="mt-3" role="status">
          <p>{p.result.summary}</p>
          {p.result.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {p.result.links.map((l) => (
                <ButtonLink key={l.to} to={l.to} size="sm">
                  {l.label}
                </ButtonLink>
              ))}
            </div>
          )}
        </Alert>
      )}

      {stale ? (
        <Alert tone="warning" title="Cette proposition n'est plus valable" className="mt-3" role="alert">
          {code === "PROPOSAL_STALE" || p.status === "superseded"
            ? "La situation a changé depuis sa préparation (prix, abonnement ou conditions). Rien n'a été exécuté."
            : "Son délai de validité est dépassé. Rien n'a été exécuté."}
          <div className="mt-2">
            {onRenew ? (
              <Button size="sm" variant="outline" onClick={onRenew}>
                {renewLabel}
              </Button>
            ) : p.type === "purchase" ? (
              <ButtonLink size="sm" variant="outline" to={`/commande?offre=${p.resource.id}`}>
                Revoir l'offre à jour et commander
              </ButtonLink>
            ) : p.resource.type === "subscription" ? (
              <ButtonLink size="sm" variant="outline" to={`/compte/abonnements/${p.resource.id}`}>
                Reprendre depuis l'abonnement
              </ButtonLink>
            ) : null}
          </div>
        </Alert>
      ) : (
        (confirm.error || reject.error) && (
          <div className="mt-3">
            <InlineError error={confirm.error ?? reject.error} />
          </div>
        )
      )}

      {p.status === "pending" && !stale && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => !busy && reject.mutate()} loading={reject.isPending} disabled={busy}>
            Refuser
          </Button>
          <Button onClick={() => !busy && confirm.mutate()} loading={confirm.isPending} disabled={busy}>
            Confirmer
          </Button>
        </div>
      )}
    </section>
  );
}
