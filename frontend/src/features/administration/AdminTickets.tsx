import { Link, useSearchParams } from "react-router-dom";
import { brand } from "@/config/app";
import type { SupportStatus } from "@/contracts/models";
import { SupportStatusBadge } from "@/components/StatusBadges";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateShort } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminTickets() {
  useDocumentTitle(`Tickets · ${brand.name}`);
  const tz = useTimeZone();
  const [params, setParams] = useSearchParams();
  const status = (params.get("statut") ?? "") as SupportStatus | "";
  const cases = useAdminQuery(["cases", status], ({ signal }) => api.admin.supportCases({ status: status || undefined }, { signal }));
  return (
    <div>
      <PageHeader title="Tickets d'assistance" description="Chaque intervention sur un compte lecteur exige un ticket et un motif ; elle est auditée." />
      <div className="mb-4 max-w-xs">
        <label htmlFor="tk-status" className="mb-1.5 block text-sm font-medium">Statut</label>
        <Select id="tk-status" value={status} onChange={(e) => setParams(e.target.value ? { statut: e.target.value } : {})}>
          <option value="">Tous</option>
          {(Object.keys(t.supportStatus) as SupportStatus[]).map((s) => <option key={s} value={s}>{t.supportStatus[s]}</option>)}
        </Select>
      </div>
      {cases.isPending ? <LoadingBlock lines={5} /> : cases.isError ? <ErrorState error={cases.error} onRetry={() => cases.refetch()} /> : (
        <DataTable
          caption="Tickets"
          rows={cases.data}
          rowKey={(c) => c.id}
          columns={[
            { header: "Objet", primary: true, cell: (c) => <Link to={`/admin/tickets/${c.id}`} className="text-brand hover:underline">{c.reference} — {c.subject}</Link> },
            { header: "Lecteur", cell: (c) => c.requester.label },
            { header: "Catégorie", cell: (c) => t.supportCategory[c.category] },
            { header: "Assigné à", cell: (c) => c.assignee?.label ?? "Non assigné" },
            { header: "Mis à jour", cell: (c) => formatDateShort(c.updated_at, tz) },
            { header: "Statut", cell: (c) => <SupportStatusBadge status={c.status} /> },
          ]}
        />
      )}
    </div>
  );
}
