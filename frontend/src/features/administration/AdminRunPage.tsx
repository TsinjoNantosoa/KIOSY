import { useParams } from "react-router-dom";
import { brand } from "@/config/app";
import { RunStatusBadge } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/Badge";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Card, CardTitle, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminRunPage() {
  const { runId = "" } = useParams();
  const tz = useTimeZone();
  const diag = useAdminQuery(["run", runId], ({ signal }) => api.admin.run(runId, { signal }));
  useDocumentTitle(`Run ${runId} · ${brand.name}`);
  if (diag.isPending) return <LoadingBlock lines={8} />;
  if (diag.isError) return <ErrorState error={diag.error} onRetry={() => diag.refetch()} />;
  const d = diag.data;
  const costLabel =
    d.cost.kind === "unavailable" || d.cost.amount_usd === null
      ? d.is_simulated ? "Non mesuré — simulation, aucun appel facturable" : "Non disponible"
      : `${d.cost.amount_usd.toFixed(4)} USD (${d.cost.kind === "estimated" ? `estimation, tarif ${d.cost.tariff_version ?? "non versionné"} — n'est pas la facture fournisseur` : "mesuré"})`;
  return (
    <div className="space-y-6">
      <PageHeader title={d.request_summary} eyebrow={<span className="font-mono normal-case">{d.run.id}</span>} back={{ to: "/admin/runs", label: "Diagnostic IA" }} actions={<RunStatusBadge status={d.run.status} />} />
      {d.is_simulated && <Alert tone="warning">Traitement simulé en mode démonstration. Les agents et outils listés décrivent le scénario joué, pas un appel réel.</Alert>}
      <Card>
        <CardTitle>Synthèse</CardTitle>
        <DefinitionList
          items={[
            { term: "Acteur", value: d.actor_label },
            { term: "Conversation", value: <code className="text-xs">{d.run.conversation_id}</code> },
            { term: "Modèle", value: d.model },
            { term: "Version de prompt", value: d.prompt_version },
            { term: "Tokens", value: d.tokens ? `${d.tokens.input} en entrée · ${d.tokens.output} en sortie` : "Non mesurés" },
            { term: "Coût", value: costLabel },
            { term: "Début / fin", value: `${formatDateTime(d.run.created_at, tz)} → ${formatDateTime(d.run.updated_at, tz)}` },
            ...(d.run.error ? [{ term: "Erreur", value: <span className="text-danger">{d.run.error.code} — {d.run.error.message}</span> }] : []),
          ]}
        />
      </Card>
      <Card>
        <CardTitle>Étapes</CardTitle>
        <DataTable
          caption="Étapes du traitement"
          rows={d.steps}
          rowKey={(s) => s.id}
          columns={[
            { header: "Agent", primary: true, cell: (s) => s.agent },
            { header: "Outil", cell: (s) => (s.tool ? <code className="text-xs">{s.tool}</code> : "—") },
            { header: "Serveur MCP", cell: (s) => s.mcp_server ?? "—" },
            { header: "Durée", cell: (s) => `${s.duration_ms} ms` },
            { header: "Statut", cell: (s) => <Badge tone={s.status === "ok" ? "success" : s.status === "failed" ? "danger" : "warning"}>{s.status}{s.error_code ? ` · ${s.error_code}` : ""}</Badge> },
            { header: "Résultat résumé", cell: (s) => s.summary },
            { header: "Références", cell: (s) => (s.evidence_refs.length ? <span className="font-mono text-xs">{s.evidence_refs.join(", ")}</span> : "—") },
          ]}
        />
      </Card>
    </div>
  );
}
