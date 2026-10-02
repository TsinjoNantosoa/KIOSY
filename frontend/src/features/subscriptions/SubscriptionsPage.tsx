import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Newspaper } from "lucide-react";
import { brand } from "@/config/app";
import { SubscriptionStatusBadge } from "@/components/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";

export default function SubscriptionsPage() {
  useDocumentTitle(`Abonnements · ${brand.name}`);
  const uid = useUid();
  const tz = useTimeZone();
  const subs = useQuery({ queryKey: qk.subscriptions(uid), queryFn: ({ signal }) => api.me.subscriptions({ signal }) });
  return (
    <div>
      <PageHeader title="Mes abonnements" description="Renouvellement manuel : aucun prélèvement automatique n'est effectué." actions={<ButtonLink to="/offres" variant="outline">Voir les offres</ButtonLink>} />
      {subs.isPending ? (
        <LoadingBlock lines={5} />
      ) : subs.isError ? (
        <ErrorState error={subs.error} onRetry={() => subs.refetch()} />
      ) : subs.data.length === 0 ? (
        <EmptyState title="Aucun abonnement" icon={<Newspaper className="h-8 w-8" />} action={<ButtonLink to="/offres">Comparer les abonnements</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {subs.data.map((s) => (
            <li key={s.id} className="card-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-serif text-xl font-semibold">
                    <Link to={`/compte/abonnements/${s.id}`} className="hover:underline">{s.offer.title}</Link>
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    {s.scope_label} · {formatMoney(s.offer.price)} / {formatDuration(s.offer.duration)}
                  </p>
                  <p className="mt-1 text-sm">
                    Période : {formatDate(s.current_period_start, tz)} → {formatDate(s.current_period_end, tz)}
                  </p>
                  {s.scheduled_change && <p className="mt-1 text-sm text-info">Changement programmé : {s.scheduled_change.target_offer_title}</p>}
                </div>
                <SubscriptionStatusBadge status={s.status} />
              </div>
              <div className="mt-4">
                <ButtonLink to={`/compte/abonnements/${s.id}`} size="sm" variant="outline">Gérer l'abonnement</ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
