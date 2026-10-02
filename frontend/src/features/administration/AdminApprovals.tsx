import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { brand } from "@/config/app";
import type { ApprovalRequest } from "@/contracts/models";
import { ProposalStatusBadge } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { api } from "@/services/api";
import { hasAnyRole, useSession, useTimeZone } from "@/features/auth/session";
import { useAdminKey, useAdminQuery } from "./shared";

export default function AdminApprovals() {
  useDocumentTitle(`Approbations · ${brand.name}`);
  const approvals = useAdminQuery(["approvals"], ({ signal }) => api.admin.approvals({ signal }));
  return (
    <div>
      <PageHeader title="Propositions et approbations" description="Exceptions commerciales et rétablissements d'accès : un responsable valide ; le demandeur ne peut pas approuver sa propre demande." />
      {approvals.isPending ? <LoadingBlock lines={4} /> : approvals.isError ? <ErrorState error={approvals.error} onRetry={() => approvals.refetch()} /> : approvals.data.length === 0 ? (
        <EmptyState title="Aucune demande d'approbation" />
      ) : (
        <ul className="space-y-4">
          {approvals.data.map((a) => <ApprovalItem key={a.id} approval={a} />)}
        </ul>
      )}
    </div>
  );
}

function ApprovalItem({ approval }: { approval: ApprovalRequest }) {
  const { user } = useSession();
  const tz = useTimeZone();
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const { keyFor } = useIdempotencyKey();
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => api.admin.decideApproval(approval.id, { decision: d, reason }, { idempotencyKey: keyFor({ id: approval.id, d, reason }) }),
    onSuccess: () => {
      setDecision(null);
      client.invalidateQueries({ queryKey: adminKey("approvals") });
      client.invalidateQueries({ queryKey: adminKey("ops") });
    },
  });
  const isManager = hasAnyRole(user, ["manager"]);
  const isRequester = user?.id === approval.requested_by.id;
  const p = approval.proposal;
  return (
    <li className="card-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold">{p.title}</h2>
          <p className="text-sm text-ink-muted">
            Demandé par {approval.requested_by.label} · {formatDateTime(p.created_at, tz)}
            {approval.case_id && <> · <Link to={`/admin/tickets/${approval.case_id}`} className="text-brand underline">ticket lié</Link></>}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge tone={approval.status === "pending" ? "warning" : approval.status === "approved" ? "success" : "neutral"}>
            {approval.status === "pending" ? "En attente" : approval.status === "approved" ? "Approuvée" : "Refusée"}
          </Badge>
          <ProposalStatusBadge status={p.status} />
        </div>
      </div>
      <p className="mt-3 text-sm"><span className="text-ink-muted">Motif :</span> {approval.reason}</p>
      <ul className="mt-2 list-disc pl-5 text-sm">{p.consequences.map((c) => <li key={c}>{c}</li>)}</ul>
      <p className="mt-2 text-xs text-ink-subtle">Échéance de la demande : {formatDateTime(p.expires_at, tz)}</p>
      {approval.decided_by && <p className="mt-2 text-sm">Décision de {approval.decided_by.label} le {formatDateTime(approval.decided_at!, tz)}.</p>}

      {approval.status === "pending" && (
        <div className="mt-4">
          {!isManager ? (
            <p className="text-sm text-ink-muted">En attente d'un responsable.</p>
          ) : isRequester ? (
            <p className="text-sm text-caution">Vous avez formulé cette demande : un autre responsable doit la valider.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDecision("approve")}>Approuver</Button>
              <Button size="sm" variant="outline" onClick={() => setDecision("reject")}>Refuser</Button>
            </div>
          )}
        </div>
      )}
      <Dialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === "approve" ? "Approuver la demande" : "Refuser la demande"}
        description="La décision et son motif sont enregistrés dans l'audit. Le serveur revalide la demande et vos droits."
        footer={
          <>
            <Button variant="outline" onClick={() => setDecision(null)}>Annuler</Button>
            <Button variant={decision === "approve" ? "primary" : "danger"} loading={decide.isPending} disabled={reason.trim().length < 5} onClick={() => decision && !decide.isPending && decide.mutate(decision)}>
              Confirmer
            </Button>
          </>
        }
      >
        <Field label="Motif de la décision" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {decide.error && <div className="mt-3"><InlineError error={decide.error} /></div>}
      </Dialog>
    </li>
  );
}
