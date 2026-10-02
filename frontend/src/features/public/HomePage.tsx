import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpenCheck, MessageCircleQuestion, Search, ShieldCheck } from "lucide-react";
import { brand } from "@/config/app";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Form";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { PublicationGrid, UNIVERSES } from "@/features/catalog/components";
import { useAssistantPanel } from "@/features/assistant/panelState";
import { DemoBadge } from "@/components/ui/Badge";

export function HomePage() {
  useDocumentTitle(`${brand.name} · Presse, business et culture`);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const featured = useQuery({ queryKey: qk.featured, queryFn: ({ signal }) => api.catalog.featured({ signal }) });
  const offers = useQuery({ queryKey: qk.offers({}), queryFn: ({ signal }) => api.offers.list({}, { signal }) });
  const openAssistant = useAssistantPanel((s) => s.open);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(q.trim() ? `/catalogue?q=${encodeURIComponent(q.trim())}` : "/catalogue");
  };

  const subscriptions = (offers.data ?? []).filter((o) => o.kind === "subscription" && o.duration?.count === 1);

  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-surface to-paper">
        <div className="container grid gap-10 py-12 md:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-warm">Kiosque numérique</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.1] md:text-5xl">
              Lisez la presse, le business et la culture, <span className="text-brand">au même endroit</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
              Comparez clairement ce que chaque offre inclut, retrouvez vos lectures dans une bibliothèque unique et obtenez de l'aide sur vos accès sans changer de service.
            </p>
            <form role="search" onSubmit={onSearch} className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
              <label htmlFor="home-search" className="sr-only">
                Rechercher une publication
              </label>
              <Input id="home-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, thème, éditeur…" className="sm:flex-1" />
              <Button type="submit" icon={<Search className="h-4 w-4" aria-hidden />}>
                {t.common.search}
              </Button>
            </form>
          </div>
          <div className="grid gap-3">
            {UNIVERSES.map((u, i) => (
              <Link
                key={u}
                to={`/catalogue?univers=${u}`}
                className="group flex items-center justify-between rounded-card border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-brand"
              >
                <span>
                  <span className="block font-serif text-2xl font-semibold">{t.universe[u]}</span>
                  <span className="text-sm text-ink-muted">{t.universeTagline[u]}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden font-serif text-4xl text-line sm:block" aria-hidden>
                    0{i + 1}
                  </span>
                  <ArrowRight className="h-5 w-5 text-brand transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container py-14" aria-labelledby="selection-title">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 id="selection-title" className="text-3xl font-semibold">
              Parutions récentes
            </h2>
            <p className="mt-1 text-ink-muted">Deux titres par univers, parmi les dernières éditions publiées.</p>
          </div>
          <ButtonLink to="/catalogue" variant="outline" className="hidden sm:inline-flex">
            {t.common.seeAll}
          </ButtonLink>
        </div>
        {featured.isPending ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : featured.isError ? (
          <ErrorState error={featured.error} onRetry={() => featured.refetch()} />
        ) : (
          <PublicationGrid items={featured.data} wide />
        )}
        <ButtonLink to="/catalogue" variant="outline" className="mt-8 w-full sm:hidden">
          Voir tout le catalogue
        </ButtonLink>
      </section>

      <section className="border-y border-line bg-surface" aria-labelledby="offers-title">
        <div className="container py-14">
          <h2 id="offers-title" className="text-3xl font-semibold">
            Des offres simples à comparer
          </h2>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Contenus gratuits, achat d'une édition à l'unité ou abonnement thématique. Le renouvellement est toujours <strong>manuel</strong> : aucun prélèvement automatique.
          </p>
          <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
            {offers.isPending
              ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44" />)
              : subscriptions.map((offer) => (
                  <div key={offer.id} className="flex flex-col rounded-card border border-line bg-paper p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-serif text-xl font-semibold">{offer.title.replace(/ — mensuel$/, "")}</h3>
                      {offer.is_demo && <DemoBadge label="Prix fictif" />}
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">{offer.description}</p>
                    <p className="mt-4 text-2xl font-semibold">
                      {formatMoney(offer.price)} <span className="text-sm font-normal text-ink-muted">/ {formatDuration(offer.duration)}</span>
                    </p>
                    <p className="text-xs text-ink-subtle">Renouvellement manuel</p>
                  </div>
                ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink to="/offres">Comparer toutes les offres</ButtonLink>
            <ButtonLink to="/catalogue?prix=free" variant="outline">
              Voir les contenus gratuits
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="container grid gap-10 py-14 lg:grid-cols-2 lg:items-center" aria-labelledby="kia-title">
        <div>
          <h2 id="kia-title" className="text-3xl font-semibold">
            {brand.assistantName}, un assistant qui prépare, vous décidez
          </h2>
          <p className="mt-3 text-ink-muted">{t.assistant.intro}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => openAssistant()} icon={<MessageCircleQuestion className="h-4 w-4" aria-hidden />}>
              Poser une question à {brand.assistantName}
            </Button>
            <ButtonLink to="/aide" variant="outline">
              Comment ça marche
            </ButtonLink>
          </div>
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Feature icon={<BookOpenCheck className="h-5 w-5" aria-hidden />} title="Pas d'achat en double">
            Avant chaque commande, nous vérifions si vous avez déjà accès au contenu.
          </Feature>
          <Feature icon={<ShieldCheck className="h-5 w-5" aria-hidden />} title="Confirmation explicite">
            Aucun paiement ni changement d'abonnement sans votre validation.
          </Feature>
          <Feature icon={<Search className="h-5 w-5" aria-hidden />} title="Sources ouvrables">
            Les réponses sur les conditions citent le passage concerné.
          </Feature>
          <Feature icon={<MessageCircleQuestion className="h-5 w-5" aria-hidden />} title="Toujours sans assistant">
            Chaque action reste possible depuis les pages et formulaires classiques.
          </Feature>
        </ul>
      </section>
    </>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="rounded-card border border-line bg-surface p-5">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-soft text-brand">{icon}</span>
      <h3 className="mt-3 font-sans text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-ink-muted">{children}</p>
    </li>
  );
}
