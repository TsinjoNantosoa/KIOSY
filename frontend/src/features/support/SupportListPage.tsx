import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { brand } from "@/config/app";
import { SupportStatusBadge } from "@/components/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { formatDateShort } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";

export default function SupportListPage() {
  useDocumentTitle(`Assistance · ${brand.name}`);
  const uid = useUid();
  const tz = useTimeZone();
  const cases = useQuery({ queryKey: qk.cases(uid), queryFn: ({ signal }) => api.support.list({ signal }) });
  return (
    <div>
      <PageHeader title="Mes demandes d'assistance" actions={<ButtonLink to="/compte/assistance/nouvelle">Nouvelle demande</ButtonLink>} />
      {cases.isPending ? (
        <LoadingBlock />
      ) : cases.isError ? (
        <ErrorState error={cases.error} onRetry={() => cases.refetch()} />
      ) : cases.data.length === 0 ? (
        <EmptyState title="Aucune demande" icon={<LifeBuoy className="h-8 w-8" />}>
          En cas de problème d'accès, de paiement ou d'abonnement, ouvrez une demande : elle est rattachée à votre compte.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {cases.data.map((c) => (
            <li key={c.id} className="card-surface flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link to={`/compte/assistance/${c.id}`} className="font-medium hover:underline">{c.subject}</Link>
                <p className="text-sm text-ink-muted">
                  {c.reference} · {t.supportCategory[c.category]} · mis à jour le {formatDateShort(c.updated_at, tz)}
                </p>
              </div>
              <SupportStatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
