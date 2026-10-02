import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { brand } from "@/config/app";
import type { EditorialStatus } from "@/contracts/models";
import { EditorialStatusBadge } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateShort } from "@/lib/format";
import { useDebouncedValue, useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminQuery } from "./shared";

export default function AdminCatalog() {
  useDocumentTitle(`Catalogue · Administration · ${brand.name}`);
  const tz = useTimeZone();
  const [status, setStatus] = useState<EditorialStatus | "">("");
  const [q, setQ] = useState("");
  const query = useDebouncedValue(q, 250);
  const editions = useAdminQuery(["editions", status, query], ({ signal }) => api.admin.editions({ status: status || undefined, q: query || undefined }, { signal }));
  return (
    <div>
      <PageHeader
        title="Gestion du catalogue"
        description="Cycle éditorial : brouillon → à revoir → publié → suspendu ou archivé. Seule l'administration publie au MVP."
        actions={<ButtonLink to="/admin/catalogue/nouveau" icon={<Plus className="h-4 w-4" aria-hidden />}>Nouvelle publication</ButtonLink>}
      />
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="adm-q" className="mb-1.5 block text-sm font-medium">Rechercher</label>
          <Input id="adm-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre ou édition" />
        </div>
        <div>
          <label htmlFor="adm-status" className="mb-1.5 block text-sm font-medium">Statut</label>
          <Select id="adm-status" value={status} onChange={(e) => setStatus(e.target.value as EditorialStatus | "")}>
            <option value="">Tous</option>
            {(Object.keys(t.editorialStatus) as EditorialStatus[]).map((s) => <option key={s} value={s}>{t.editorialStatus[s]}</option>)}
          </Select>
        </div>
      </div>
      {editions.isPending ? (
        <LoadingBlock lines={6} />
      ) : editions.isError ? (
        <ErrorState error={editions.error} onRetry={() => editions.refetch()} />
      ) : (
        <DataTable
          caption="Éditions du catalogue"
          rows={editions.data}
          rowKey={(r) => r.edition.id}
          columns={[
            { header: "Publication", primary: true, cell: (r) => <Link to={`/admin/catalogue/${r.edition.id}`} className="text-brand hover:underline">{r.publication.title}</Link> },
            { header: "Édition", cell: (r) => r.edition.label },
            { header: "Éditeur", cell: (r) => r.publication.publisher.name },
            { header: "Format", cell: (r) => t.format[r.edition.format] },
            { header: "Date", cell: (r) => formatDateShort(r.edition.published_at, tz) },
            { header: "Fichier", cell: (r) => (r.edition.asset_id ? <Badge tone="success">Traité</Badge> : <Badge tone="warning">Manquant</Badge>) },
            { header: "Diffusion", cell: (r) => (r.edition.availability.state === "available" ? "Disponible" : <Badge tone="danger">Droits expirés</Badge>) },
            { header: "Statut", cell: (r) => <EditorialStatusBadge status={r.edition.status} /> },
          ]}
        />
      )}
    </div>
  );
}
