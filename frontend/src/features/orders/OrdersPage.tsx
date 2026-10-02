import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Receipt } from "lucide-react";
import { brand } from "@/config/app";
import { OrderStatusBadge } from "@/components/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateShort, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";

export default function OrdersPage() {
  useDocumentTitle(`Commandes · ${brand.name}`);
  const uid = useUid();
  const tz = useTimeZone();
  const orders = useQuery({ queryKey: qk.orders(uid), queryFn: ({ signal }) => api.me.orders({ signal }) });
  return (
    <div>
      <PageHeader title="Mes commandes" />
      {orders.isPending ? (
        <LoadingBlock lines={5} />
      ) : orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
      ) : orders.data.length === 0 ? (
        <EmptyState title="Aucune commande" icon={<Receipt className="h-8 w-8" />} action={<ButtonLink to="/catalogue">Explorer le catalogue</ButtonLink>} />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {orders.data.map((o) => (
              <li key={o.id} className="card-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/compte/commandes/${o.id}`} className="font-medium hover:underline">{o.lines[0]?.label}</Link>
                  <OrderStatusBadge status={o.status} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">{o.reference} · {formatDateShort(o.created_at, tz)} · {formatMoney(o.total)}</p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Liste des commandes</caption>
              <thead className="bg-sunken/60">
                <tr>
                  <th scope="col" className="p-3">Référence</th>
                  <th scope="col" className="p-3">Offre</th>
                  <th scope="col" className="p-3">Date</th>
                  <th scope="col" className="p-3 text-right">Montant</th>
                  <th scope="col" className="p-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="p-3 font-medium"><Link to={`/compte/commandes/${o.id}`} className="text-brand hover:underline">{o.reference}</Link></td>
                    <td className="p-3">{o.lines[0]?.label}</td>
                    <td className="p-3 whitespace-nowrap">{formatDateShort(o.created_at, tz)}</td>
                    <td className="p-3 text-right whitespace-nowrap">{formatMoney(o.total)}</td>
                    <td className="p-3"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
