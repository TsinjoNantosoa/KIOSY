import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { appConfig, brand } from "@/config/app";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadges";
import { DemoBadge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Card, CardTitle, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";

export default function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const uid = useUid();
  const tz = useTimeZone();
  const order = useQuery({ queryKey: qk.order(uid, orderId), queryFn: ({ signal }) => api.commerce.getOrder(orderId, { signal }) });
  useDocumentTitle(`Commande ${order.data?.reference ?? ""} · ${brand.name}`);
  if (order.isPending) return <LoadingBlock lines={8} />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;
  const line = o.lines[0]!;
  return (
    <div className="space-y-6">
      <PageHeader title={`Commande ${o.reference}`} back={{ to: "/compte/commandes", label: "Mes commandes" }} actions={<OrderStatusBadge status={o.status} />} />
      {o.status === "pending_payment" && (
        <Alert tone="warning" title="En attente de paiement">
          <ButtonLink to={`/commande/${o.id}`} size="sm" className="mt-2">Voir l'état du paiement</ButtonLink>
        </Alert>
      )}
      {o.exception_reason && <Alert tone={o.status === "payment_exception" ? "danger" : "info"}>{o.exception_reason}</Alert>}
      <Card>
        <CardTitle>Offre achetée (instantané)</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">Ces informations reflètent l'offre au moment de la commande, même si elle a évolué depuis.</p>
        <DefinitionList
          items={[
            { term: "Offre", value: `${line.snapshot.title} (version ${line.snapshot.offer_version})` },
            { term: "Type", value: t.offerKind[line.snapshot.kind] },
            { term: "Contenu inclus", value: line.snapshot.scope_label },
            { term: "Durée", value: formatDuration(line.snapshot.duration) },
            { term: "Renouvellement", value: line.snapshot.renewal === "manual" ? "Manuel" : "Aucun" },
            { term: "Conditions", value: `Version ${line.snapshot.conditions_version}` },
            { term: "Montant", value: <span className="text-base">{formatMoney(o.total)}</span> },
          ]}
        />
      </Card>
      <Card>
        <CardTitle>Paiement</CardTitle>
        <DefinitionList
          items={[
            { term: "Statut", value: o.payment ? <span className="flex flex-wrap gap-2"><PaymentStatusBadge status={o.payment.status} />{o.payment.mode === "test" && <DemoBadge label="Test" />}</span> : "Aucun paiement initié" },
            { term: "Créée le", value: formatDateTime(o.created_at, tz) },
            { term: "Dernière mise à jour", value: formatDateTime(o.updated_at, tz) },
          ]}
        />
        {/* Le justificatif n'est proposé que s'il existe réellement côté serveur. */}
        {o.receipt_available ? (
          <a href={`${appConfig.apiBaseUrl}/v1/orders/${encodeURIComponent(o.id)}/receipt`} className={buttonClass("outline", "md", "mt-4")}>
            Télécharger le justificatif
          </a>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Aucun justificatif n'est encore disponible pour cette commande{o.is_demo ? " (paiement de test)" : ""}.</p>
        )}
      </Card>
      <div className="flex flex-wrap gap-3">
        {o.status === "fulfilled" && <ButtonLink to={o.edition_id ? `/lire/${o.edition_id}` : "/compte/bibliotheque"}>Accéder au contenu</ButtonLink>}
        <ButtonLink to={`/compte/assistance/nouvelle?commande=${o.id}`} variant="outline">Un problème avec cette commande ?</ButtonLink>
      </div>
    </div>
  );
}
