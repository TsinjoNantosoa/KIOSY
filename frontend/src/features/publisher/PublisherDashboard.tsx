import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { api } from "@/services/api";
import { StatCard, useAdminQuery } from "@/features/administration/shared";

export default function PublisherDashboard() {
  const editions = useAdminQuery(["publisher", "editions"], ({ signal }) => api.admin.editions({}, { signal }));
  const imports = useAdminQuery(["publisher", "imports"], ({ signal }) => api.admin.imports({ signal }));
  const analytics = useAdminQuery(["publisher", "analytics"], ({ signal }) => api.admin.publisherAnalytics({ signal }));
  if (editions.isPending || imports.isPending || analytics.isPending) return <LoadingBlock lines={6} />;
  if (editions.isError) return <ErrorState error={editions.error} onRetry={() => editions.refetch()} />;
  if (imports.isError) return <ErrorState error={imports.error} onRetry={() => imports.refetch()} />;
  if (analytics.isError) return <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />;
  const statuses = editions.data.map((row) => row.edition.status);
  const publicationCount = new Set(editions.data.map((row) => row.publication.id)).size;
  const failed = imports.data.filter((job) => job.status === "failed").length;
  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord éditeur" description="Vue limitée à vos publications, éditions et imports." />
      {failed > 0 && <Alert tone="warning">{failed} import(s) nécessitent votre attention. Aucun contenu en échec n'est présenté comme indexé.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Publications" value={publicationCount} to="/publisher/publications" />
        <StatCard label="Éditions" value={editions.data.length} to="/publisher/publications" />
        <StatCard label="Brouillons" value={statuses.filter((s) => s === "draft").length} to="/publisher/publications" />
        <StatCard label="En revue" value={statuses.filter((s) => s === "review").length} to="/publisher/publications" tone="warning" />
        <StatCard label="Corrections demandées" value={statuses.filter((s) => s === "changes_requested").length} to="/publisher/reviews" tone="danger" />
        <StatCard label="Approuvées" value={statuses.filter((s) => s === "approved").length} to="/publisher/publications" />
        <StatCard label="Publiées" value={statuses.filter((s) => s === "published").length} to="/publisher/publications" />
        <StatCard label="Imports en échec" value={failed} to="/publisher/imports" tone={failed ? "danger" : "neutral"} />
        <StatCard label="Commandes liées" value={analytics.data.orders} />
        <StatCard label="Droits activés" value={analytics.data.entitlements} />
      </div>
    </div>
  );
}
