import { brand, appConfig } from "@/config/app";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { StatCard, useAdminQuery } from "./shared";

export default function AdminDashboard() {
  useDocumentTitle(`Administration · ${brand.name}`);
  const tz = useTimeZone();
  const ops = useAdminQuery(["ops"], ({ signal }) => api.admin.ops({ signal }), { refetchInterval: 15_000 });
  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord opérationnel" description="Situations qui demandent une action. Les compteurs sont calculés à la demande." />
      <Card>
        <CardTitle>Modes actifs</CardTitle>
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li><span className="text-ink-muted">Données :</span> <strong>{appConfig.mode === "demo" ? "démonstration (mock)" : "API"}</strong></li>
          <li><span className="text-ink-muted">Paiement :</span> <strong>{appConfig.mode === "demo" ? "test simulé (aucun prestataire)" : "selon le backend"}</strong></li>
          <li><span className="text-ink-muted">Assistant :</span> <strong>{appConfig.mode === "demo" ? "scénarios simulés, aucun LLM/MCP" : "backend"}</strong></li>
        </ul>
      </Card>
      {ops.isPending ? (
        <LoadingBlock lines={4} />
      ) : ops.isError ? (
        <ErrorState error={ops.error} onRetry={() => ops.refetch()} />
      ) : (
        <>
          {ops.data.is_demo && (
            <Alert tone="warning">Compteurs issus des données fictives de démonstration : ce ne sont pas des mesures de production.</Alert>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Éditions à revoir" value={ops.data.counts.publications_in_review} to="/admin/catalogue" tone={ops.data.counts.publications_in_review ? "warning" : "neutral"} />
            <StatCard label="Imports en échec" value={ops.data.counts.imports_failed} to="/admin/imports" tone={ops.data.counts.imports_failed ? "danger" : "neutral"} />
            <StatCard label="Commandes en attente de paiement" value={ops.data.counts.orders_pending_payment} to="/admin/commerce" />
            <StatCard label="Exceptions de paiement" value={ops.data.counts.payment_exceptions} to="/admin/commerce" tone={ops.data.counts.payment_exceptions ? "danger" : "neutral"} />
            <StatCard label="Tickets ouverts" value={ops.data.counts.tickets_open} to="/admin/tickets" />
            <StatCard label="Approbations en attente" value={ops.data.counts.approvals_pending} to="/admin/approbations" tone={ops.data.counts.approvals_pending ? "warning" : "neutral"} />
            <StatCard label="Traitements IA en échec" value={ops.data.counts.runs_failed} to="/admin/runs" />
            <StatCard label="Propositions expirées" value={ops.data.counts.proposals_expired} />
          </div>
          <p className="text-xs text-ink-subtle">Généré le {formatDateTime(ops.data.generated_at, tz)}.</p>
        </>
      )}
    </div>
  );
}
