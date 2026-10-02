import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen } from "lucide-react";
import { brand } from "@/config/app";
import { OrderStatusBadge, SubscriptionStatusBadge, SupportStatusBadge } from "@/components/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { Cover } from "@/components/Cover";
import { formatDate, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useSession, useTimeZone } from "@/features/auth/session";
import { isActiveItem } from "@/features/library/LibraryPage";
import { SUBSCRIPTION_GIVES_ACCESS } from "@/contracts/rules";

export default function DashboardPage() {
  useDocumentTitle(`Mon espace · ${brand.name}`);
  const { user } = useSession();
  const uid = user?.id ?? "anon";
  const tz = useTimeZone();
  const library = useQuery({ queryKey: qk.library(uid), queryFn: ({ signal }) => api.me.library({ signal }) });
  const subs = useQuery({ queryKey: qk.subscriptions(uid), queryFn: ({ signal }) => api.me.subscriptions({ signal }) });
  const orders = useQuery({ queryKey: qk.orders(uid), queryFn: ({ signal }) => api.me.orders({ signal }) });
  const cases = useQuery({ queryKey: qk.cases(uid), queryFn: ({ signal }) => api.support.list({ signal }) });

  const recent = (library.data ?? []).filter(isActiveItem).slice(0, 4);
  const activeSubs = (subs.data ?? []).filter((s) => SUBSCRIPTION_GIVES_ACCESS[s.status]);
  const pendingOrders = (orders.data ?? []).filter((o) => o.status === "pending_payment");

  return (
    <div className="space-y-6">
      <PageHeader title={`Bonjour ${user?.display_name.split(" ")[0] ?? ""}`} description="Vos lectures, abonnements et demandes en un coup d'œil." />

      {pendingOrders.length > 0 && (
        <Card className="border-caution/40 bg-caution-soft/40">
          <p className="font-medium">{pendingOrders.length} commande(s) en attente de paiement</p>
          <ul className="mt-2 space-y-1 text-sm">
            {pendingOrders.map((o) => (
              <li key={o.id}>
                <Link to={`/commande/${o.id}`} className="text-brand underline">
                  {o.reference} — {o.lines[0]?.label}
                </Link>{" "}
                {o.payment?.status === "pending" && <span className="text-ink-muted">(paiement en cours de vérification)</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="mb-0">Accès récents</CardTitle>
          <Link to="/compte/bibliotheque" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
            Bibliothèque <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {library.isPending ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : library.isError ? (
          <ErrorState error={library.error} onRetry={() => library.refetch()} className="mt-4" />
        ) : recent.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Aucun accès actif. <Link to="/catalogue" className="text-brand underline">Explorer le catalogue</Link>.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {recent.map((item) => (
              <li key={item.edition.id}>
                <Link to={`/lire/${item.edition.id}`} className="group block">
                  <Cover spec={item.publication.cover} title={item.publication.title} />
                  <span className="mt-2 block truncate text-sm font-medium group-hover:underline">{item.publication.title}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-muted"><BookOpen className="h-3 w-3" aria-hidden /> {item.edition.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Abonnements</CardTitle>
          {subs.isPending ? (
            <Skeleton className="h-16" />
          ) : subs.isError ? (
            <ErrorState error={subs.error} onRetry={() => subs.refetch()} />
          ) : activeSubs.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucun abonnement actif. <Link to="/offres" className="text-brand underline">Voir les offres</Link>.</p>
          ) : (
            <ul className="space-y-3">
              {activeSubs.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3">
                  <div>
                    <Link to={`/compte/abonnements/${s.id}`} className="font-medium hover:underline">{s.offer.title}</Link>
                    <p className="text-sm text-ink-muted">
                      {s.status === "cancel_at_period_end" ? "Accès jusqu'au" : "Échéance le"} {formatDate(s.current_period_end, tz)} · renouvellement manuel
                    </p>
                  </div>
                  <SubscriptionStatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Commandes récentes</CardTitle>
          {orders.isPending ? (
            <Skeleton className="h-16" />
          ) : orders.isError ? (
            <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
          ) : (orders.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">Aucune commande.</p>
          ) : (
            <ul className="space-y-3">
              {orders.data.slice(0, 3).map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/compte/commandes/${o.id}`} className="block truncate font-medium hover:underline">{o.lines[0]?.label}</Link>
                    <p className="text-sm text-ink-muted">{o.reference} · {formatMoney(o.total)}</p>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="mb-0">Assistance et conversations</CardTitle>
          <div className="flex gap-2">
            <ButtonLink to="/compte/assistance/nouvelle" size="sm" variant="outline">Nouvelle demande</ButtonLink>
            <ButtonLink to="/kia" size="sm" variant="ghost">Conversations {brand.assistantName}</ButtonLink>
          </div>
        </div>
        {cases.data && cases.data.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {cases.data.slice(0, 3).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <Link to={`/compte/assistance/${c.id}`} className="truncate hover:underline">{c.reference} — {c.subject}</Link>
                <SupportStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        ) : (
          !cases.isPending && <p className="mt-4 text-sm text-ink-muted">Aucune demande d'assistance.</p>
        )}
      </Card>
    </div>
  );
}
