import { useSearchParams } from "react-router-dom";
import { brand } from "@/config/app";
import { EntitlementBadge } from "@/components/StatusBadges";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminEntitlements() {
  useDocumentTitle(`Droits d'accès · ${brand.name}`);
  const tz = useTimeZone();
  const [params, setParams] = useSearchParams();
  const userId = params.get("lecteur") ?? "";
  const users = useAdminQuery(["users"], ({ signal }) => api.admin.users({ signal }));
  const ents = useAdminQuery(["entitlements", userId], ({ signal }) => api.admin.entitlements(userId, { signal }), { enabled: Boolean(userId) });
  return (
    <div>
      <PageHeader title="Consultation des droits" description="Droits techniques de lecture : source, périmètre et période. La consultation est tracée." />
      <div className="mb-6 max-w-sm">
        <label htmlFor="ent-user" className="mb-1.5 block text-sm font-medium">Lecteur</label>
        <Select id="ent-user" value={userId} onChange={(e) => setParams(e.target.value ? { lecteur: e.target.value } : {})}>
          <option value="">Choisir un lecteur…</option>
          {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
        </Select>
      </div>
      {!userId ? (
        <p className="text-sm text-ink-muted">Sélectionnez un lecteur pour afficher ses droits.</p>
      ) : ents.isPending ? (
        <LoadingBlock lines={4} />
      ) : ents.isError ? (
        <ErrorState error={ents.error} onRetry={() => ents.refetch()} />
      ) : (
        <DataTable
          caption="Droits du lecteur"
          rows={ents.data}
          rowKey={(e) => e.id}
          empty="Aucun droit pour ce lecteur."
          columns={[
            { header: "Périmètre", primary: true, cell: (e) => (e.scope.kind === "collection" ? e.scope.label : `Édition ${e.scope.edition_id}`) },
            { header: "Source", cell: (e) => `${t.entitlementSource[e.source]} (${e.source_ref})` },
            { header: "Début", cell: (e) => formatDate(e.valid_from, tz) },
            { header: "Fin", cell: (e) => (e.valid_until ? formatDate(e.valid_until, tz) : "Sans échéance") },
            { header: "État", cell: (e) => <EntitlementBadge entitlement={e} /> },
          ]}
        />
      )}
    </div>
  );
}
