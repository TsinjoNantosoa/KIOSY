import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, LibraryBig } from "lucide-react";
import { brand } from "@/config/app";
import type { LibraryItem, Universe } from "@/contracts/models";
import { Cover } from "@/components/Cover";
import { EntitlementBadge } from "@/components/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Layout";
import { formatDate, pluralize } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";
import { UNIVERSES } from "@/features/catalog/components";

export function isActiveItem(item: LibraryItem): boolean {
  const e = item.entitlement;
  return e.status === "active" && (!e.valid_until || Date.parse(e.valid_until) > Date.now());
}

export default function LibraryPage() {
  useDocumentTitle(`Bibliothèque · ${brand.name}`);
  const uid = useUid();
  const library = useQuery({ queryKey: qk.library(uid), queryFn: ({ signal }) => api.me.library({ signal }) });
  const [q, setQ] = useState("");
  const [universe, setUniverse] = useState<Universe | "">("");
  const [state, setState] = useState<"all" | "active" | "expired">("active");

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (library.data ?? []).filter(
      (item) =>
        (!needle || `${item.publication.title} ${item.edition.label} ${item.publication.author}`.toLowerCase().includes(needle)) &&
        (!universe || item.publication.universe === universe) &&
        (state === "all" || (state === "active") === isActiveItem(item)),
    );
  }, [library.data, q, universe, state]);

  return (
    <div>
      <PageHeader title="Ma bibliothèque" description="Les contenus auxquels vous avez accès, avec la source et l'échéance de chaque droit." />
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <label htmlFor="lib-q" className="mb-1.5 block text-sm font-medium">Rechercher</label>
          <Input id="lib-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, édition, auteur" />
        </div>
        <div>
          <label htmlFor="lib-u" className="mb-1.5 block text-sm font-medium">Univers</label>
          <Select id="lib-u" value={universe} onChange={(e) => setUniverse(e.target.value as Universe | "")}>
            <option value="">Tous</option>
            {UNIVERSES.map((u) => <option key={u} value={u}>{t.universe[u]}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="lib-s" className="mb-1.5 block text-sm font-medium">Statut</label>
          <Select id="lib-s" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
            <option value="active">Accès actifs</option>
            <option value="expired">Accès expirés</option>
            <option value="all">Tous</option>
          </Select>
        </div>
      </div>

      {library.isPending ? (
        <LoadingBlock lines={6} />
      ) : library.isError ? (
        <ErrorState error={library.error} onRetry={() => library.refetch()} />
      ) : library.data.length === 0 ? (
        <EmptyState title="Votre bibliothèque est vide" icon={<LibraryBig className="h-8 w-8" />} action={<ButtonLink to="/catalogue">Explorer le catalogue</ButtonLink>}>
          Les éditions achetées et celles incluses dans vos abonnements apparaîtront ici. Les contenus gratuits se lisent directement depuis le catalogue.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun contenu ne correspond à ces filtres" />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted" role="status">{pluralize(items.length, "contenu", "contenus")}</p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {items.map((item) => <LibraryRow key={item.edition.id} item={item} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function LibraryRow({ item }: { item: LibraryItem }) {
  const tz = useTimeZone();
  const active = isActiveItem(item);
  const e = item.entitlement;
  return (
    <li className="card-surface flex gap-4 p-4">
      <Link to={`/publications/${item.publication.slug}`} tabIndex={-1} aria-hidden className="w-16 shrink-0 sm:w-20">
        <Cover spec={item.publication.cover} title={item.publication.title} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <EntitlementBadge entitlement={e} />
          <span className="text-xs text-ink-subtle">{t.format[item.edition.format]}</span>
        </div>
        <h2 className="mt-1 truncate font-serif text-lg font-semibold">{item.publication.title}</h2>
        <p className="text-sm text-ink-muted">{item.edition.label}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Via {t.entitlementSource[e.source].toLowerCase()}
          {e.scope.kind === "collection" ? ` « ${e.scope.label} »` : ""} ·{" "}
          {e.valid_until ? (active ? `jusqu'au ${formatDate(e.valid_until, tz)}` : `expiré le ${formatDate(e.valid_until, tz)}`) : "sans échéance"}
        </p>
        <div className="mt-auto pt-3">
          {active ? (
            <ButtonLink to={`/lire/${item.edition.id}`} size="sm" icon={<BookOpen className="h-4 w-4" aria-hidden />}>
              Lire
              <span className="sr-only"> {item.publication.title}, {item.edition.label}</span>
            </ButtonLink>
          ) : (
            <ButtonLink to={e.source === "subscription" ? "/compte/abonnements" : `/publications/${item.publication.slug}`} size="sm" variant="outline">
              {e.source === "subscription" ? "Renouveler l'abonnement" : "Voir les offres"}
            </ButtonLink>
          )}
        </div>
      </div>
    </li>
  );
}
