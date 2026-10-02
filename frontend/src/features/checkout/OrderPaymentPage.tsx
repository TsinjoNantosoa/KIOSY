import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Clock, CreditCard, HelpCircle, XCircle } from "lucide-react";
import { appConfig, brand } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import type { Order } from "@/contracts/models";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadges";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, ErrorState, InlineError, LoadingBlock, Spinner } from "@/components/ui/Feedback";
import { Card, PageHeader } from "@/components/ui/Layout";
import { classifyLink } from "@/lib/safeUrl";
import { formatCountdown, formatMoney } from "@/lib/format";
import { useCountdown, useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { paymentModeLabel } from "@/lib/payment";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";
import { Steps } from "./CheckoutPage";

/**
 * Page de commande et de résultat. Le statut affiché provient TOUJOURS de GET /v1/orders/{id}.
 * Les paramètres du retour prestataire (ex. ?provider_status=success) sont ignorés : un retour
 * de navigation n'est jamais une preuve de paiement (section 8).
 */
export default function OrderPaymentPage({ returning = false }: { returning?: boolean }) {
  const { orderId = "" } = useParams();
  const uid = useUid();
  useDocumentTitle(`Commande · ${brand.name}`);
  const [attempts, setAttempts] = useState(0);
  const [pollEpoch, setPollEpoch] = useState(0);
  const maxAttempts = appConfig.checkout.statusPollMaxAttempts;

  const order = useQuery({
    queryKey: qk.order(uid, orderId),
    queryFn: ({ signal }) => api.commerce.getOrder(orderId, { signal }),
    // Jamais de statut de paiement servi depuis le cache : on relit le statut autoritaire.
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const data = query.state.data;
      const verifying = data && data.status === "pending_payment" && data.payment?.status === "pending";
      return returning && verifying && attempts < maxAttempts ? appConfig.checkout.statusPollIntervalMs : false;
    },
  });

  // Compte les relectures pour basculer vers l'état « incertain » sans faux succès.
  const lastUpdate = useRef(0);
  useEffect(() => {
    if (!returning || order.dataUpdatedAt === lastUpdate.current) return;
    lastUpdate.current = order.dataUpdatedAt;
    setAttempts((a) => a + 1);
  }, [order.dataUpdatedAt, returning, pollEpoch]);

  if (order.isPending) {
    return (
      <div className="container max-w-3xl py-10">
        <LoadingBlock lines={6} />
      </div>
    );
  }
  if (order.isError) {
    return (
      <div className="container max-w-3xl py-10">
        <ErrorState error={order.error} onRetry={() => order.refetch()} />
      </div>
    );
  }

  const data = order.data;
  const verifying = data.status === "pending_payment" && data.payment?.status === "pending";
  const uncertain = verifying && (!returning || attempts >= maxAttempts);

  return (
    <div className="container max-w-3xl py-8 md:py-12">
      <PageHeader title={`Commande ${data.reference}`} back={{ to: "/compte/commandes", label: "Mes commandes" }} />
      <Steps current={data.status === "fulfilled" ? 3 : 2} />
      <OrderSummary order={data} />
      <div className="mt-6" aria-live="polite">
        {data.status === "fulfilled" ? (
          <Result tone="success" icon={<CheckCircle2 className="h-8 w-8" aria-hidden />} title="Paiement confirmé, accès attribué">
            <p>Le prestataire a confirmé le paiement et votre accès est ouvert.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <ButtonLink to={data.edition_id ? `/lire/${data.edition_id}` : "/compte/bibliotheque"}>{data.edition_id ? "Lire maintenant" : "Ouvrir ma bibliothèque"}</ButtonLink>
              {data.subscription_id && <ButtonLink to={`/compte/abonnements/${data.subscription_id}`} variant="outline">Voir l'abonnement</ButtonLink>}
            </div>
          </Result>
        ) : data.status === "payment_exception" ? (
          <Result tone="danger" icon={<HelpCircle className="h-8 w-8" aria-hidden />} title="Paiement à régulariser">
            <p>{data.exception_reason}</p>
            <p className="mt-2">Aucune action n'est nécessaire de votre part pour éviter un double paiement. Vous pouvez suivre le dossier avec l'assistance.</p>
            <div className="mt-4">
              <ButtonLink to={`/compte/assistance/nouvelle?commande=${data.id}`} variant="outline">Contacter l'assistance</ButtonLink>
            </div>
          </Result>
        ) : data.status === "cancelled" ? (
          <Result tone="neutral" icon={<XCircle className="h-8 w-8" aria-hidden />} title="Commande annulée">
            <p>{data.exception_reason ?? "Cette commande n'est plus active."} Aucun accès n'a été attribué.</p>
            <div className="mt-4">
              <ButtonLink to="/offres" variant="outline">Revoir les offres</ButtonLink>
            </div>
          </Result>
        ) : verifying && !uncertain ? (
          <Result tone="info" icon={<Clock className="h-8 w-8" aria-hidden />} title="Vérification du paiement en cours">
            <Spinner label="Nous attendons la confirmation du prestataire…" />
            <p className="mt-2 text-sm">Ne fermez pas cette page si vous le souhaitez, mais ne payez pas une seconde fois.</p>
          </Result>
        ) : uncertain ? (
          <Result tone="warning" icon={<HelpCircle className="h-8 w-8" aria-hidden />} title="Statut du paiement encore inconnu">
            <p>Le prestataire n'a pas encore confirmé le résultat. Votre accès sera attribué automatiquement dès que le paiement sera confirmé.</p>
            <p className="mt-2 font-medium">Ne relancez pas de paiement : la commande reste réservée à ce paiement en cours de vérification.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                loading={order.isFetching}
                onClick={() => {
                  setAttempts(0);
                  setPollEpoch((e) => e + 1);
                  void order.refetch();
                }}
              >
                Vérifier à nouveau
              </Button>
              <ButtonLink to={`/compte/assistance/nouvelle?commande=${data.id}`} variant="ghost">Signaler un problème</ButtonLink>
            </div>
          </Result>
        ) : (
          <PayAction order={data} />
        )}
      </div>
    </div>
  );
}

function OrderSummary({ order }: { order: Order }) {
  const line = order.lines[0]!;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={order.status} />
        {order.payment && <PaymentStatusBadge status={order.payment.status} />}
        {order.payment?.mode === "test" && <DemoBadge label={paymentModeLabel("test")} />}
        {order.payment?.mode === "sandbox" && <Badge tone="warning">{paymentModeLabel("sandbox")}</Badge>}
        {order.payment?.mode === "live" && <Badge tone="success">{paymentModeLabel("live")}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold">{line.label}</h2>
        <p className="text-xl font-semibold">{formatMoney(order.total)}</p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{line.snapshot.scope_label} · conditions {line.snapshot.conditions_version}</p>
      {order.reservation?.status === "reserved" && order.status === "pending_payment" && <ReservationCountdown expiresAt={order.reservation.expires_at} />}
    </Card>
  );
}

function ReservationCountdown({ expiresAt }: { expiresAt: string }) {
  const remaining = useCountdown(expiresAt);
  if (remaining === null) return null;
  return (
    <p className="mt-3 rounded-md bg-caution-soft px-3 py-2 text-sm text-caution" role="timer" aria-live="off">
      {remaining > 0 ? (
        <>Place réservée encore <strong>{formatCountdown(remaining)}</strong> (échéance fixée par le serveur).</>
      ) : (
        <>La réservation arrive à échéance ; le serveur confirmera son statut.</>
      )}
    </p>
  );
}

function Result({ tone, icon, title, children }: { tone: "success" | "danger" | "neutral" | "info" | "warning"; icon: ReactNode; title: string; children: ReactNode }) {
  const colors = { success: "border-brand/30 bg-brand-soft text-brand-strong", danger: "border-danger/30 bg-danger-soft text-danger", neutral: "border-line bg-sunken text-ink-muted", info: "border-info/30 bg-info-soft text-info", warning: "border-caution/30 bg-caution-soft text-caution" }[tone];
  return (
    <section className={`rounded-card border p-5 ${colors}`}>
      <div className="flex gap-4">
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0 text-ink">
          <h2 className="font-serif text-xl font-semibold">{title}</h2>
          <div className="mt-2 text-sm leading-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

function PayAction({ order }: { order: Order }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const uid = useUid();
  const { keyFor, reset } = useIdempotencyKey(uid, `checkout:${order.id}`);
  // Une nouvelle tentative après échec ou annulation est une nouvelle intention.
  const intent = { order: order.id, attempt: order.payment?.updated_at ?? "first" };
  const checkout = useMutation({
    mutationFn: () => api.commerce.createCheckout(order.id, { idempotencyKey: keyFor(intent) }),
    onSuccess: (session) => {
      const link = classifyLink(session.redirect_url);
      if (link.kind === "internal") navigate(link.to);
      else if (link.kind === "external") window.location.assign(link.href);
      else throw new Error("URL de paiement refusée");
    },
    onError: (error) => {
      if (isApiError(error) && error.kind === "conflict") {
        reset();
        client.invalidateQueries({ queryKey: qk.order(uid, order.id) });
      }
    },
  });
  const failed = order.payment?.status === "failed";
  const cancelled = order.payment?.status === "cancelled";
  return (
    <div className="space-y-4">
      {failed && <Alert tone="danger" title="Paiement refusé">Le prestataire a refusé le paiement. Aucun montant n'a été débité. Vous pouvez réessayer.</Alert>}
      {cancelled && <Alert tone="info" title="Paiement annulé">Vous avez quitté la page de paiement. Aucun montant n'a été débité.</Alert>}
      {checkout.error && <InlineError error={checkout.error} />}
      <Card>
        <h2 className="font-serif text-xl font-semibold">Paiement</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {order.is_demo ? "Démonstration locale : aucune transaction réelle n'est effectuée. " : order.payment?.mode === "sandbox" ? "Le prestataire est en environnement sandbox. " : ""}L'accès est attribué uniquement après confirmation du paiement par le prestataire.
        </p>
        <Button className="mt-4 w-full sm:w-auto" onClick={() => !checkout.isPending && checkout.mutate()} loading={checkout.isPending} icon={<CreditCard className="h-4 w-4" aria-hidden />}>
          {failed || cancelled ? "Réessayer le paiement" : "Payer"} {formatMoney(order.total)}
        </Button>
        <p className="mt-3 text-xs text-ink-subtle">
          Vous préférez ne pas payer maintenant ? La commande reste dans <Link to="/compte/commandes" className="underline">vos commandes</Link>.
        </p>
      </Card>
    </div>
  );
}
