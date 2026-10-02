import { Link } from "react-router-dom";
import { brand } from "@/config/app";
import { RunStatusBadge } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/Badge";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminRuns() {
  useDocumentTitle(`Diagnostic IA · ${brand.name}`);
  const tz = useTimeZone();
  const runs = useAdminQuery(["runs"], ({ signal }) => api.admin.runs({ signal }));
  return (
    <div>
      <PageHeader title="Diagnostic des traitements IA" description="Agents, outils, durées, erreurs et références. Aucune chaîne de pensée n'est conservée ni affichée." />
      {runs.data?.some((r) => r.is_simulated) && (
        <Alert tone="warning" className="mb-4">Traitements simulés (mode démonstration) : aucun modèle ni serveur MCP n'a été appelé ; tokens et coûts ne sont pas mesurés.</Alert>
      )}
      {runs.isPending ? <LoadingBlock lines={5} /> : runs.isError ? <ErrorState error={runs.error} onRetry={() => runs.refetch()} /> : (
        <DataTable
          caption="Traitements IA"
          rows={runs.data}
          rowKey={(r) => r.run.id}
          columns={[
            { header: "Run", primary: true, cell: (r) => <Link to={`/admin/runs/${r.run.id}`} className="font-mono text-xs text-brand hover:underline">{r.run.id}</Link> },
            { header: "Demande", cell: (r) => r.request_summary },
            { header: "Acteur", cell: (r) => r.actor_label },
            { header: "Agents", cell: (r) => [...new Set(r.steps.map((s) => s.agent))].join(", ") },
            { header: "Début", cell: (r) => formatDateTime(r.run.created_at, tz), className: "whitespace-nowrap" },
            { header: "Statut", cell: (r) => <span className="flex flex-wrap gap-1"><RunStatusBadge status={r.run.status} />{r.is_simulated && <Badge tone="warm">Simulé</Badge>}</span> },
          ]}
        />
      )}
    </div>
  );
}
