import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { api } from "@/services/api";
import { DataTable, useAdminQuery } from "@/features/administration/shared";

export default function PublisherReviews() {
  const rows = useAdminQuery(["publisher", "corrections"], ({ signal }) => api.admin.publisherReviews({ signal }));
  if (rows.isPending) return <LoadingBlock lines={4} />;
  if (rows.isError) return <ErrorState error={rows.error} onRetry={() => rows.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Demandes de correction" description="Modifiez le contenu demandé, puis soumettez une nouvelle version à la revue." />
      <DataTable caption="Éditions à corriger" rows={rows.data} rowKey={(row) => row.id} empty="Aucune correction demandée."
        columns={[
          { header: "Publication", primary: true, cell: (row) => <Link className="text-brand underline" to={`/publisher/publications/${row.edition_id}`}>{row.publication_title}</Link> },
          { header: "Édition", cell: (row) => row.edition_label },
          { header: "Décision", cell: () => <Badge tone="danger">Corrections demandées</Badge> },
          { header: "Remarque", cell: (row) => row.comment },
        ]} />
    </div>
  );
}
