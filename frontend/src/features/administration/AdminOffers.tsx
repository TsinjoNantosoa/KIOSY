import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { brand } from "@/config/app";
import type { Offer } from "@/contracts/models";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { ButtonLink } from "@/components/ui/Button";
import { formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { DataTable, useAdminQuery } from "./shared";

export function OfferStatus({ offer }: { offer: Offer }) {
  if (offer.status === "active") return <Badge tone="success">Active</Badge>;
  if (offer.status === "sold_out") return <Badge tone="danger">Épuisée</Badge>;
  if (offer.status === "retired") return <Badge>Retirée</Badge>;
  return <Badge tone="danger">Indisponible</Badge>;
}

export default function AdminOffers() {
  useDocumentTitle(`Offres · Administration · ${brand.name}`);
  const offers = useAdminQuery(["offers"], ({ signal }) => api.admin.offers({ signal }));
  return (
    <div>
      <PageHeader title="Gestion des offres" description="Chaque modification crée une nouvelle version ; les commandes passées conservent l'instantané acheté." actions={<ButtonLink to="/admin/offres/nouvelle" icon={<Plus className="h-4 w-4" aria-hidden />}>Nouvelle offre</ButtonLink>} />
      {offers.isPending ? (
        <LoadingBlock lines={6} />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : (
        <DataTable
          caption="Offres"
          rows={offers.data}
          rowKey={(o) => o.id}
          columns={[
            { header: "Offre", primary: true, cell: (o) => <Link to={`/admin/offres/${o.id}`} className="text-brand hover:underline">{o.title}</Link> },
            { header: "Type", cell: (o) => t.offerKind[o.kind] },
            { header: "Prix", cell: (o) => formatMoney(o.price), className: "whitespace-nowrap" },
            { header: "Durée", cell: (o) => (o.kind === "free" ? "—" : formatDuration(o.duration)) },
            { header: "Quota", cell: (o) => (o.quota ? `${o.quota.remaining} / ${o.quota.total}` : "Non contingentée") },
            { header: "Version", cell: (o) => `v${o.version}` },
            { header: "Statut", cell: (o) => <OfferStatus offer={o} /> },
          ]}
        />
      )}
    </div>
  );
}
