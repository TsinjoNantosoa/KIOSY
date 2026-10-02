import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BookOpen, CalendarDays, Eye, FileText, Languages, Scale } from "lucide-react";
import { brand } from "@/config/app";
import type { Edition } from "@/contracts/models";
import { Cover } from "@/components/Cover";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, ErrorState, LoadingBlock, Skeleton } from "@/components/ui/Feedback";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useSession, useTimeZone } from "@/features/auth/session";
import { OfferCard, useEligibility } from "@/features/offers/OfferCard";

export default function PublicationPage() {
  const { idOrSlug = "" } = useParams();
  const { user } = useSession();
  const tz = useTimeZone();
  const detail = useQuery({ queryKey: qk.publication(idOrSlug), queryFn: ({ signal }) => api.catalog.getPublication(idOrSlug, { signal }) });
  const publicationId = detail.data?.publication.id ?? "";
  const access = useQuery({
    queryKey: qk.access(user?.id ?? "anon", publicationId),
    queryFn: ({ signal }) => api.me.access(publicationId, { signal }),
    enabled: Boolean(user && publicationId),
  });
  const offerIds = detail.data?.offers.map((o) => o.id) ?? [];
  const eligibility = useEligibility(offerIds);
  const [selectedEditionId, setSelectedEditionId] = useState<string | null>(null);
  const [excerptFor, setExcerptFor] = useState<Edition | null>(null);
  useDocumentTitle(`${detail.data?.publication.title ?? "Publication"} · ${brand.name}`);

  if (detail.isPending) {
    return (
      <div className="container grid gap-8 py-10 md:grid-cols-[16rem_1fr]">
        <Skeleton className="aspect-[3/4]" />
        <LoadingBlock lines={6} />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="container py-10">
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      </div>
    );
  }

  const { publication, editions, offers } = detail.data;
  const edition = editions.find((e) => e.id === selectedEditionId) ?? editions[0]!;
  const readable = new Set(access.data?.readable_edition_ids ?? []);
  const canRead = edition.is_free || readable.has(edition.id);
  const unavailable = edition.availability.state !== "available";
  const editionOffers = offers.filter((o) => o.scope.kind !== "edition" || o.scope.edition_id === edition.id);
  const sortedOffers = [...editionOffers].sort((a, b) => ["single", "subscription", "free"].indexOf(a.kind) - ["single", "subscription", "free"].indexOf(b.kind));

  return (
    <div className="container py-8 md:py-12">
      <nav aria-label="Fil d'Ariane" className="mb-6 text-sm text-ink-muted">
        <Link to="/catalogue" className="hover:underline">
          Catalogue
        </Link>{" "}
        /{" "}
        <Link to={`/catalogue?univers=${publication.universe}`} className="hover:underline">
          {t.universe[publication.universe]}
        </Link>{" "}
        / <span aria-current="page">{publication.title}</span>
      </nav>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[16rem_1fr] lg:gap-12">
        <div className="mx-auto w-48 md:w-full">
          <Cover spec={publication.cover} title={publication.title} size="lg" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warm">{t.universe[publication.universe]}</Badge>
            {publication.is_demo && <DemoBadge label="Contenu fictif" />}
          </div>
          <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">{publication.title}</h1>
          <p className="mt-2 text-lg text-ink-muted">
            {publication.author} · {publication.publisher.name}
          </p>
          <p className="mt-5 max-w-prose text-lg leading-relaxed">{publication.summary}</p>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta icon={<BookOpen className="h-4 w-4" />} term="Édition" value={edition.label} />
            <Meta icon={<CalendarDays className="h-4 w-4" />} term="Publication" value={formatDate(edition.published_at, tz)} />
            <Meta icon={<FileText className="h-4 w-4" />} term="Format" value={`${t.format[edition.format]}${edition.page_count ? ` · ${edition.page_count} p.` : edition.word_count ? ` · ${edition.word_count} mots` : ""}`} />
            <Meta icon={<Languages className="h-4 w-4" />} term="Langue" value={t.language[edition.language]} />
          </dl>

          {editions.length > 1 && (
            <div className="mt-6">
              <label htmlFor="edition-select" className="mb-1.5 block text-sm font-medium">
                Choisir une édition ({editions.length} disponibles)
              </label>
              <select
                id="edition-select"
                className="min-h-11 w-full max-w-sm rounded-md border border-line bg-surface px-3"
                value={edition.id}
                onChange={(e) => setSelectedEditionId(e.target.value)}
              >
                {editions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} — {formatDate(e.published_at, tz)}
                    {readable.has(e.id) ? " (accessible)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {unavailable && (
              <Alert tone="danger" title="Édition indisponible">
                {edition.availability.reason ?? "Cette édition n'est plus proposée."} Les nouvelles ventes sont suspendues.
              </Alert>
            )}
            {canRead && !unavailable && (
              <Alert tone="success" title={edition.is_free ? "Contenu gratuit" : "Vous avez déjà accès à cette édition"}>
                {edition.is_free ? "Lecture libre, sans achat." : "Inutile de l'acheter à nouveau : elle est incluse dans vos accès."}
              </Alert>
            )}
            <div className="flex flex-wrap gap-3">
              {canRead && !unavailable && (
                <ButtonLink to={`/lire/${edition.id}`} icon={<BookOpen className="h-4 w-4" aria-hidden />}>
                  Lire maintenant
                </ButtonLink>
              )}
              {edition.permissions.public_excerpt && (
                <Button variant="outline" onClick={() => setExcerptFor(edition)} icon={<Eye className="h-4 w-4" aria-hidden />}>
                  Lire l'extrait
                </Button>
              )}
              <ButtonLink to={`/offres?publication=${publication.id}`} variant="ghost" icon={<Scale className="h-4 w-4" aria-hidden />}>
                Comparer les offres
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>

      {!unavailable || offers.some((o) => o.kind === "subscription") ? (
        <section className="mt-12" aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="text-2xl font-semibold">
            Offres pour lire « {edition.label} »
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Prix calculés par le serveur. Le total définitif est confirmé au récapitulatif de commande.</p>
          {sortedOffers.length === 0 ? (
            <p className="mt-4 text-ink-muted">Aucune offre n'est proposée pour cette édition.</p>
          ) : (
            <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedOffers.map((offer) => (
                <li key={offer.id}>
                  <OfferCard offer={offer} eligibility={eligibility.data?.get(offer.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <ExcerptDialog edition={excerptFor} title={publication.title} onClose={() => setExcerptFor(null)} />
    </div>
  );
}

function Meta({ icon, term, value }: { icon: ReactNode; term: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <dt className="flex items-center gap-1.5 text-ink-muted">
        <span aria-hidden>{icon}</span>
        {term}
      </dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function ExcerptDialog({ edition, title, onClose }: { edition: Edition | null; title: string; onClose: () => void }) {
  const excerpt = useQuery({
    queryKey: qk.excerpt(edition?.id ?? ""),
    queryFn: ({ signal }) => api.catalog.getExcerpt(edition!.id, { signal }),
    enabled: Boolean(edition),
  });
  return (
    <Dialog open={Boolean(edition)} onOpenChange={(open) => !open && onClose()} title={`Extrait — ${title}`} description={edition?.label} size="lg">
      {excerpt.isPending ? (
        <LoadingBlock lines={6} />
      ) : excerpt.isError ? (
        <ErrorState error={excerpt.error} onRetry={() => excerpt.refetch()} />
      ) : (
        <div>
          <SafeMarkdown source={excerpt.data.markdown} headingOffset={1} className="kiosy-compact" />
          {excerpt.data.truncated && <p className="mt-4 text-sm font-medium text-ink-muted">[…] La suite est réservée aux lecteurs disposant d'un accès.</p>}
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-subtle">{excerpt.data.notice}</p>
        </div>
      )}
    </Dialog>
  );
}
