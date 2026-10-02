import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { brand } from "@/config/app";
import type { OrderStatus } from "@/contracts/models";
import { OrderStatusBadge, PaymentStatusBadge, SubscriptionStatusBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/Button";
import { ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatDate, formatDateShort, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { hasAnyRole, useSession, useTimeZone } from "@/features/auth/session";
import { DataTable, useAdminKey, useAdminQuery } from "./shared";

export default function AdminCommerce() {
  useDocumentTitle(`Commandes et abonnements · ${brand.name}`);
  const [params, setParams] = useSearchParams();
  const tab = params.get("vue") === "abonnements" ? "subscriptions" : "orders";
  return (
    <div>
      <PageHeader title="Commandes et abonnements" />
      <div role="tablist" aria-label="Vue" className="mb-6 inline-flex rounded-md border border-line bg-surface p-1">
        {(["orders", "subscriptions"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={tab === v}
            onClick={() => setParams(v === "orders" ? {} : { vue: "abonnements" })}
            className={cn("min-h-10 rounded px-4 text-sm font-medium", tab === v ? "bg-brand text-white" : "text-ink-muted hover:bg-sunken")}
          >
            {v === "orders" ? "Commandes" : "Abonnements"}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "orders" ? <Orders /> : <Subscriptions />}</div>
    </div>
  );
}

function Orders() {
  const tz = useTimeZone();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const status = (params.get("statut") ?? "") as OrderStatus | "";
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const { notify } = useToast();
  const orders = useAdminQuery(["orders", status], ({ signal }) => api.admin.orders({ status: status || undefined }, { signal }));
  const reconcile = useMutation({
    mutationFn: api.admin.reconcilePayment,
    onSuccess: (order) => {
      notify(`Réconciliation effectuée : ${t.orderStatus[order.status]}.`, "info");
      client.invalidateQueries({ queryKey: adminKey("orders") });
    },
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <label htmlFor="ord-status" className="mb-1.5 block text-sm font-medium">Statut</label>
        <Select id="ord-status" value={status} onChange={(e) => setParams(e.target.value ? { statut: e.target.value } : {})}>
          <option value="">Tous</option>
          {(Object.keys(t.orderStatus) as OrderStatus[]).map((s) => <option key={s} value={s}>{t.orderStatus[s]}</option>)}
        </Select>
      </div>
      {reconcile.error && <div className="mb-4"><InlineError error={reconcile.error} /></div>}
      {orders.isPending ? <LoadingBlock lines={5} /> : orders.isError ? <ErrorState error={orders.error} onRetry={() => orders.refetch()} /> : (
        <DataTable
          caption="Commandes"
          rows={orders.data}
          rowKey={(o) => o.id}
          columns={[
            { header: "Référence", primary: true, cell: (o) => o.reference },
            { header: "Client", cell: (o) => o.customer.display_name },
            { header: "Offre", cell: (o) => o.lines[0]?.label },
            { header: "Montant", cell: (o) => formatMoney(o.total), className: "whitespace-nowrap" },
            { header: "Date", cell: (o) => formatDateShort(o.created_at, tz) },
            { header: "Commande", cell: (o) => <OrderStatusBadge status={o.status} /> },
            { header: "Paiement", cell: (o) => (o.payment ? <PaymentStatusBadge status={o.payment.status} /> : "—") },
            {
              header: "Action",
              cell: (o) =>
                o.status === "pending_payment" && o.payment?.status === "pending" && hasAnyRole(user, ["admin"]) ? (
                  <Button size="sm" variant="outline" loading={reconcile.isPending && reconcile.variables === o.id} onClick={() => reconcile.mutate(o.id)}>
                    Réconcilier
                  </Button>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      )}
      <p className="mt-3 text-xs text-ink-subtle">La réconciliation relit le statut chez le prestataire avec la même référence ; elle ne crée jamais de second paiement.</p>
    </>
  );
}

function Subscriptions() {
  const tz = useTimeZone();
  const subs = useAdminQuery(["subscriptions"], ({ signal }) => api.admin.subscriptions({ signal }));
  if (subs.isPending) return <LoadingBlock lines={5} />;
  if (subs.isError) return <ErrorState error={subs.error} onRetry={() => subs.refetch()} />;
  return (
    <DataTable
      caption="Abonnements"
      rows={subs.data}
      rowKey={(s) => s.id}
      columns={[
        { header: "Abonnement", primary: true, cell: (s) => s.offer.title },
        { header: "Client", cell: (s) => s.customer.display_name },
        { header: "Période", cell: (s) => `${formatDate(s.current_period_start, tz)} → ${formatDate(s.current_period_end, tz)}` },
        { header: "Renouvellement", cell: () => "Manuel" },
        { header: "Statut", cell: (s) => <SubscriptionStatusBadge status={s.status} /> },
      ]}
    />
  );
}
