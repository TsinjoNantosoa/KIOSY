import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { appConfig, brand } from "@/config/app";
import type { CatalogFacets, CatalogQuery } from "@/contracts/models";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Layout";
import { useDebouncedValue, useDocumentTitle } from "@/lib/hooks";
import { pluralize } from "@/lib/format";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { PublicationGrid, UNIVERSES } from "./components";
import { readCatalogQuery, SORT_LABELS, writeCatalogQuery } from "./catalogQuery";

export default function CatalogPage() {
  useDocumentTitle(`Catalogue · ${brand.name}`);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readCatalogQuery(params), [params]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [text, setText] = useState(query.q ?? "");
  const debounced = useDebouncedValue(text, appConfig.catalog.searchDebounceMs);

  // Synchronise la saisie vers l'URL (remplacement : pas d'entrée d'historique par frappe).
  useEffect(() => {
    const next = debounced.trim() || undefined;
    if (next !== query.q) update({ q: next }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Et l'URL vers la saisie (retour arrière, lien partagé).
  useEffect(() => setText(query.q ?? ""), [query.q]);

  const update = (patch: Partial<CatalogQuery>, replace = false) => {
    const next = { ...query, ...patch, page: patch.page ?? 1 };
    setParams(writeCatalogQuery(next), { replace });
  };

  const result = useQuery({
    queryKey: qk.catalog(query),
    queryFn: ({ signal }) => api.catalog.search({ ...query, page_size: appConfig.catalog.pageSize }, { signal }),
    placeholderData: keepPreviousData,
  });

  const activeFilters = (["universe", "language", "format", "price"] as const).filter((k) => query[k]);
  const facets = result.data?.facets;

  const filters = (prefix: string) => <Filters prefix={prefix} query={query} facets={facets} onChange={(patch) => update(patch)} />;

  return (
    <div className="container py-8 md:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold md:text-4xl">Catalogue</h1>
        <p className="mt-1 text-ink-muted">Presse, business et culture de plusieurs éditeurs.</p>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1" role="search">
          <label htmlFor="catalog-search" className="mb-1.5 block text-sm font-medium">
            Rechercher
          </label>
          <Input id="catalog-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Titre, auteur, thème, éditeur…" maxLength={100} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 sm:w-52">
            <label htmlFor="catalog-sort" className="mb-1.5 block text-sm font-medium">
              Trier par
            </label>
            <Select id="catalog-sort" value={query.sort ?? (query.q ? "relevance" : "recent")} onChange={(e) => update({ sort: e.target.value as CatalogQuery["sort"] })}>
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" className="self-end lg:hidden" onClick={() => setFiltersOpen(true)} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />} aria-haspopup="dialog">
            Filtres{activeFilters.length > 0 && ` (${activeFilters.length})`}
          </Button>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-2" aria-label="Filtres actifs">
          {activeFilters.map((key) => (
            <li key={key}>
              <button type="button" onClick={() => update({ [key]: undefined })} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3 text-sm font-medium text-brand-strong hover:border-brand">
                {filterLabel(key, query)}
                <X className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">(retirer ce filtre)</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="min-h-9 px-2 text-sm text-ink-muted underline" onClick={() => setParams(writeCatalogQuery({ q: query.q, sort: query.sort }))}>
              Tout effacer
            </button>
          </li>
        </ul>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filtres">
          {filters("d")}
        </aside>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filtres">
          <div className="flex-1 overflow-y-auto p-4">{filters("m")}</div>
          <div className="border-t border-line bg-surface p-4">
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>
              Voir {result.data ? pluralize(result.data.total, "résultat", "résultats") : "les résultats"}
            </Button>
          </div>
        </Sheet>

        <section aria-labelledby="results-title" aria-busy={result.isFetching}>
          <h2 id="results-title" className="sr-only">
            Résultats
          </h2>
          <p className="mb-4 text-sm text-ink-muted" role="status" aria-live="polite">
            {result.data && !result.isPlaceholderData ? pluralize(result.data.total, "publication trouvée", "publications trouvées") : result.isFetching ? t.common.loading : ""}
          </p>
          {result.isPending ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-[3/4]" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          ) : result.isError ? (
            <ErrorState error={result.error} onRetry={() => result.refetch()} />
          ) : result.data.items.length === 0 ? (
            <EmptyState
              title="Aucune publication ne correspond"
              action={
                <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  Réinitialiser la recherche
                </Button>
              }
            >
              {query.q ? <>Aucun résultat pour « {query.q} » avec ces filtres. </> : null}
              Essayez un autre mot-clé ou retirez un filtre. Le catalogue ne couvre pour l'instant que la presse, le business et la culture.
            </EmptyState>
          ) : (
            <div className={result.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <PublicationGrid items={result.data.items} />
              <Pagination
                page={result.data.page}
                pageSize={result.data.page_size}
                total={result.data.total}
                hrefFor={(page) => `/catalogue?${writeCatalogQuery({ ...query, page }).toString()}`}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function filterLabel(key: "universe" | "language" | "format" | "price", query: CatalogQuery): string {
  if (key === "universe" && query.universe) return t.universe[query.universe];
  if (key === "language" && query.language) return t.language[query.language];
  if (key === "format" && query.format) return t.format[query.format];
  if (key === "price" && query.price) return query.price === "free" ? "Gratuit" : "Payant";
  return "";
}

function Filters({ prefix, query, facets, onChange }: { prefix: string; query: CatalogQuery; facets?: CatalogFacets; onChange: (patch: Partial<CatalogQuery>) => void }) {
  const languages = facets ? (Object.keys(facets.language) as (keyof typeof t.language)[]) : ["fr" as const];
  return (
    <div className="space-y-6">
      <RadioGroup
        prefix={prefix}
        legend="Univers"
        name="univers"
        value={query.universe}
        options={UNIVERSES.map((u) => ({ value: u, label: t.universe[u], count: facets?.universe[u] }))}
        onChange={(v) => onChange({ universe: v })}
      />
      <RadioGroup
        prefix={prefix}
        legend="Format"
        name="format"
        value={query.format}
        options={(["text", "pdf"] as const).map((f) => ({ value: f, label: t.format[f], count: facets?.format[f] }))}
        onChange={(v) => onChange({ format: v })}
      />
      <RadioGroup
        prefix={prefix}
        legend="Prix"
        name="prix"
        value={query.price}
        options={[
          { value: "free" as const, label: "Contenus gratuits" },
          { value: "paid" as const, label: "Achat à l'unité possible" },
        ]}
        onChange={(v) => onChange({ price: v })}
      />
      <RadioGroup
        prefix={prefix}
        legend="Langue"
        name="langue"
        value={query.language}
        options={languages.map((l) => ({ value: l, label: t.language[l], count: facets?.language[l] }))}
        onChange={(v) => onChange({ language: v })}
      />
    </div>
  );
}

function RadioGroup<T extends string>({
  prefix,
  legend,
  name,
  value,
  options,
  onChange,
}: {
  prefix: string;
  legend: string;
  name: string;
  value: T | undefined;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T | undefined) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="space-y-1">
        {[{ value: undefined, label: "Tous", count: undefined }, ...options].map((option) => {
          const id = `f-${prefix}-${name}-${option.value ?? "all"}`;
          return (
            <label key={id} htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-sunken">
              <input id={id} type="radio" name={`${prefix}-${name}`} className="h-4 w-4 accent-brand" checked={value === option.value} onChange={() => onChange(option.value)} />
              <span className="flex-1">{option.label}</span>
              {option.count !== undefined && <span className="text-xs text-ink-subtle">{option.count}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
