import { Link } from "react-router-dom";
import { FileText, FileType2 } from "lucide-react";
import type { CatalogItem, Universe } from "@/contracts/models";
import { Cover } from "@/components/Cover";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/format";
import { t } from "@/locales";

export function FormatIcon({ format }: { format: "text" | "pdf" }) {
  const Icon = format === "pdf" ? FileType2 : FileText;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}

/** Carte de publication homogène : couverture, titre, éditeur, format et prix d'appel. */
export function PublicationCard({ item, headingLevel = "h3" }: { item: CatalogItem; headingLevel?: "h2" | "h3" }) {
  const { publication, latest_edition: edition } = item;
  const Heading = headingLevel;
  const unavailable = edition.availability.state !== "available";
  return (
    <article className="cv-auto group relative flex min-w-0 w-full flex-col">
      <Cover spec={publication.cover} title={publication.title} className="w-full transition-transform group-hover:-translate-y-0.5 motion-reduce:transform-none" />
      <div className="mt-3 flex flex-1 flex-col">
        <p className="text-xs font-medium uppercase tracking-wider text-warm">{t.universe[publication.universe]}</p>
        <Heading className="mt-1 font-serif text-lg font-semibold leading-snug">
          <Link to={`/publications/${publication.slug}`} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
            {publication.title}
          </Link>
        </Heading>
        <p className="mt-0.5 text-sm text-ink-muted">{edition.label}</p>
        <p className="mt-0.5 truncate text-xs text-ink-subtle">{publication.publisher.name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {item.formats.map((f) => (
            <Badge key={f}>
              <FormatIcon format={f} />
              {t.format[f]}
            </Badge>
          ))}
          {item.has_free_content && <Badge tone="brand">Gratuit</Badge>}
          {unavailable && <Badge tone="danger">Indisponible</Badge>}
          {publication.is_demo && <DemoBadge />}
        </div>
        <p className="mt-auto pt-2 text-sm font-semibold">
          {item.price_from ? (
            <>
              <span className="font-normal text-ink-muted">à partir de </span>
              {formatMoney(item.price_from)}
            </>
          ) : item.has_free_content ? (
            "Gratuit"
          ) : (
            <span className="font-normal text-ink-muted">Via abonnement</span>
          )}
        </p>
      </div>
    </article>
  );
}

export function PublicationGrid({ items, headingLevel, wide = false }: { items: CatalogItem[]; headingLevel?: "h2" | "h3"; wide?: boolean }) {
  return (
    <ul className={wide ? "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6" : "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"}>
      {items.map((item) => (
        <li key={item.publication.id} className="flex min-w-0">
          <PublicationCard item={item} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export const UNIVERSES: Universe[] = ["presse", "business", "culture"];
