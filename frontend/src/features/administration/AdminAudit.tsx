import { useState } from "react";
import { brand } from "@/config/app";
import type { AuditEvent } from "@/contracts/models";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateTime } from "@/lib/format";
import { useDebouncedValue, useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminAudit() {
  useDocumentTitle(`Audit · ${brand.name}`);
  const tz = useTimeZone();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<AuditEvent["result"] | "">("");
  const query = useDebouncedValue(q, 250);
  const audit = useAdminQuery(["audit", query, result], ({ signal }) => api.admin.audit({ q: query || undefined, result: result || undefined }, { signal }));
  return (
    <div>
      <PageHeader title="Historique d'audit" description="Événements ajoutés sans modification. Les jetons, liens signés et secrets n'y figurent pas." />
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label htmlFor="au-q" className="mb-1.5 block text-sm font-medium">Rechercher</label>
          <Input id="au-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, acteur, cible, motif" />
        </div>
        <div>
          <label htmlFor="au-r" className="mb-1.5 block text-sm font-medium">Résultat</label>
          <Select id="au-r" value={result} onChange={(e) => setResult(e.target.value as AuditEvent["result"] | "")}>
            <option value="">Tous</option>
            <option value="success">Succès</option>
            <option value="denied">Refusé</option>
            <option value="failed">Échec</option>
          </Select>
        </div>
      </div>
      {audit.isPending ? <LoadingBlock lines={6} /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : (
        <>
          <p className="mb-3 text-sm text-ink-muted">{audit.data.total} événement(s){audit.data.total > audit.data.items.length ? `, ${audit.data.items.length} affichés` : ""}.</p>
          <DataTable
            caption="Événements d'audit"
            rows={audit.data.items}
            rowKey={(e) => e.id}
            columns={[
              { header: "Date", primary: true, cell: (e) => formatDateTime(e.at, tz), className: "whitespace-nowrap" },
              { header: "Acteur", cell: (e) => e.actor.label },
              { header: "Action", cell: (e) => <code className="text-xs">{e.action}</code> },
              { header: "Cible", cell: (e) => e.target.label },
              { header: "Motif", cell: (e) => e.reason ?? "—" },
              { header: "Résultat", cell: (e) => <Badge tone={e.result === "success" ? "success" : e.result === "denied" ? "warning" : "danger"}>{e.result === "success" ? "Succès" : e.result === "denied" ? "Refusé" : "Échec"}</Badge> },
              { header: "Requête", cell: (e) => <code className="text-xs text-ink-subtle">{e.request_id}</code> },
            ]}
          />
        </>
      )}
    </div>
  );
}
