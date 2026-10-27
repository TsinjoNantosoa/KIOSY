import { Link } from "react-router-dom";
import { EditorialStatusBadge } from "@/components/StatusBadges";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { api } from "@/services/api";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminEditorialReviews() {
  const rows = useAdminQuery(["editorial-reviews"], ({ signal }) => api.admin.editions({}, { signal }));
  if (rows.isPending) return <LoadingBlock lines={5} />;
  if (rows.isError) return <ErrorState error={rows.error} onRetry={() => rows.refetch()} />;
  const pending = rows.data.filter((row) => row.edition.status === "review" || row.edition.status === "approved");
  return (
    <div className="space-y-6">
      <PageHeader title="Revue éditoriale" description="Soumissions éditeur en attente d'une décision administrative auditée." />
      <DataTable caption="Soumissions éditoriales" rows={pending} rowKey={(row) => row.edition.id} empty="Aucune soumission en attente."
        columns={[
          { header: "Publication", primary: true, cell: (row) => <Link className="text-brand underline" to={`/admin/catalogue/${row.edition.id}`}>{row.publication.title}</Link> },
          { header: "Éditeur", cell: (row) => row.publication.publisher.name },
          { header: "Édition", cell: (row) => row.edition.label },
          { header: "Statut", cell: (row) => <EditorialStatusBadge status={row.edition.status} /> },
          { header: "Ingestion", cell: (row) => row.edition.asset_id ? "Prête" : "Fichier manquant" },
        ]} />
    </div>
  );
}
