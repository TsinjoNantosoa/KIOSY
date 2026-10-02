import type { CatalogQuery, CatalogSort, ContentFormat, Language, PriceFilter, Universe } from "@/contracts/models";

/** Correspondance URL ↔ requête catalogue. Les filtres vivent dans l'URL (retour, rechargement, partage). */
const UNIVERSES: Universe[] = ["presse", "business", "culture"];
const LANGUAGES: Language[] = ["fr", "mg", "en"];
const FORMATS: ContentFormat[] = ["text", "pdf"];
const PRICES: PriceFilter[] = ["free", "paid"];
const SORTS: CatalogSort[] = ["relevance", "recent", "title", "price_asc", "price_desc"];

function pick<T extends string>(value: string | null, allowed: T[]): T | undefined {
  return value && (allowed as string[]).includes(value) ? (value as T) : undefined;
}

export function readCatalogQuery(params: URLSearchParams): CatalogQuery {
  const page = Number(params.get("page"));
  return {
    q: params.get("q")?.slice(0, 100) || undefined,
    universe: pick(params.get("univers"), UNIVERSES),
    language: pick(params.get("langue"), LANGUAGES),
    format: pick(params.get("format"), FORMATS),
    price: pick(params.get("prix"), PRICES),
    sort: pick(params.get("tri"), SORTS),
    page: Number.isInteger(page) && page > 1 && page < 1000 ? page : 1,
  };
}

const URL_NAMES: Record<Exclude<keyof CatalogQuery, "page_size">, string> = {
  q: "q",
  universe: "univers",
  language: "langue",
  format: "format",
  price: "prix",
  sort: "tri",
  page: "page",
};

export function writeCatalogQuery(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(URL_NAMES) as [keyof typeof URL_NAMES, string][]) {
    const value = query[key];
    if (value === undefined || value === "" || (key === "page" && value === 1)) continue;
    params.set(name, String(value));
  }
  return params;
}

export const SORT_LABELS: Record<CatalogSort, string> = {
  relevance: "Pertinence",
  recent: "Plus récents",
  title: "Titre (A → Z)",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
};
