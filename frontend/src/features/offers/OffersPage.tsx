import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { brand } from "@/config/app";
import type { Eligibility, Offer } from "@/contracts/models";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { cn } from "@/lib/cn";
import { formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useSession } from "@/features/auth/session";
import { renewalLabel, useEligibility } from "./OfferCard";

function situation(offer: Offer, eligibility: Eligibility | undefined, loggedIn: boolean): { text: string; tone: "success" | "warning" | "danger" | "neutral" | "info" } {
  if (offer.status !== "active") return { text: offer.status_reason ?? "Indisponible", tone: "danger" };
  if (offer.quota && offer.quota.remaining <= 0) return { text: "Épuisée", tone: "danger" };
  if (offer.kind === "free") return { text: "Accessible sans achat", tone: "info" };
  if (!loggedIn) return { text: "Connectez-vous pour vérifier vos accès", tone: "neutral" };
  if (!eligibility) return { text: "Vérification…", tone: "neutral" };
  if (eligibility.already_owned) return { text: "Déjà inclus dans vos accès", tone: "success" };
  if (eligibility.blocking_reason === "PENDING_ORDER") return { text: "Commande en attente de paiement", tone: "warning" };
  if (eligibility.overlaps.length > 0) return { text: "Chevauchement partiel avec vos accès", tone: "warning" };
  return { text: "Aucun accès équivalent détecté", tone: "neutral" };
}

export default function OffersPage() {
  useDocumentTitle(`Offres · ${brand.name}`);
  const [params] = useSearchParams();
  const publicationId = params.get("publication") ?? undefined;
  const navigate = useNavigate();
  const { user } = useSession();
  const offers = useQuery({ queryKey: qk.offers({ publication_id: publicationId }), queryFn: ({ signal }) => api.offers.list({ publication_id: publicationId }, { signal }) });
  const publication = useQuery({
    queryKey: qk.publication(publicationId ?? ""),
    queryFn: ({ signal }) => api.catalog.getPublication(publicationId!, { signal }),
    enabled: Boolean(publicationId),
  });
  const list = offers.data ?? [];
  const eligibility = useEligibility(list.map((o) => o.id));
  const [selected, setSelected] = useState<string | null>(null);
  const selectedOffer = list.find((o) => o.id === selected) ?? null;
  const selectedElig = selectedOffer ? eligibility.data?.get(selectedOffer.id) : undefined;
  const canContinue = Boolean(selectedOffer && selectedOffer.kind !== "free" && selectedOffer.status === "active" && !(selectedElig && !selectedElig.can_purchase));

  const continueWith = () => {
    if (!selectedOffer) return;
    const target = `/commande?offre=${selectedOffer.id}`;
    navigate(user ? target : `/connexion?retour=${encodeURIComponent(target)}`);
  };

  return (
    <div className="container py-8 md:py-12">
      <PageHeader
        title="Comparer les offres"
        description={
          publication.data ? (
            <>
              Offres permettant de lire <Link to={`/publications/${publication.data.publication.slug}`} className="font-medium text-brand underline">{publication.data.publication.title}</Link>.
            </>
          ) : (
            "Abonnements thématiques et contenus gratuits. L'achat à l'unité se choisit depuis la fiche de chaque publication."
          )
        }
      />
      <Alert tone="info" className="mb-6">
        Aucune offre n'est présélectionnée. Le renouvellement des abonnements est <strong>manuel</strong> : rien n'est prélevé automatiquement. Les prix de démonstration sont fictifs.
      </Alert>

      {offers.isPending ? (
        <LoadingBlock lines={6} />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="Aucune offre disponible" />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            continueWith();
          }}
        >
          <fieldset>
            <legend className="sr-only">Sélectionnez une offre</legend>
            {/* Mobile : cartes empilées */}
            <div className="grid gap-3 md:hidden">
              {list.map((offer) => {
                const s = situation(offer, eligibility.data?.get(offer.id), Boolean(user));
                return (
                  <label key={offer.id} htmlFor={`m-${offer.id}`} className={cn("block cursor-pointer rounded-card border bg-surface p-4", selected === offer.id ? "border-brand ring-2 ring-brand/30" : "border-line")}>
                    <span className="flex items-start gap-3">
                      <input id={`m-${offer.id}`} type="radio" name="offer-m" className="mt-1 h-5 w-5 accent-brand" checked={selected === offer.id} onChange={() => setSelected(offer.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-lg font-semibold">{offer.title}</span>
                        <span className="mt-1 block text-xl font-semibold">{formatMoney(offer.price)}</span>
                        <span className="mt-2 block text-sm text-ink-muted">
                          {offer.scope.label} · {offer.kind === "free" ? "sans durée" : formatDuration(offer.duration)} · {renewalLabel(offer)}
                        </span>
                        {offer.restrictions.length > 0 && <span className="mt-1 block text-xs text-ink-subtle">{offer.restrictions.join(" ")}</span>}
                        <span className="mt-2 block">
                          <Badge tone={s.tone}>{s.text}</Badge>
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {/* Desktop : tableau comparatif */}
            <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <caption className="sr-only">Comparaison des offres</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken/60">
                    <th scope="col" className="w-12 p-3">
                      <span className="sr-only">Sélection</span>
                    </th>
                    <th scope="col" className="p-3">Offre</th>
                    <th scope="col" className="p-3">Contenu inclus</th>
                    <th scope="col" className="p-3">Durée</th>
                    <th scope="col" className="p-3">Renouvellement</th>
                    <th scope="col" className="p-3">Restrictions</th>
                    <th scope="col" className="p-3 text-right">Prix</th>
                    <th scope="col" className="p-3">Votre situation</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((offer) => {
                    const s = situation(offer, eligibility.data?.get(offer.id), Boolean(user));
                    return (
                      <tr key={offer.id} className={cn("border-b border-line last:border-0", selected === offer.id && "bg-brand-soft/60")} onClick={() => setSelected(offer.id)}>
                        <td className="p-3 align-top">
                          <input id={`d-${offer.id}`} type="radio" name="offer-d" className="h-5 w-5 accent-brand" checked={selected === offer.id} onChange={() => setSelected(offer.id)} aria-label={`Sélectionner ${offer.title}`} />
                        </td>
                        <th scope="row" className="p-3 align-top font-medium">
                          <label htmlFor={`d-${offer.id}`} className="cursor-pointer">
                            {offer.title}
                          </label>
                          <span className="mt-1 flex gap-1">
                            <Badge>{t.offerKind[offer.kind]}</Badge>
                            {offer.is_demo && <DemoBadge label="Fictif" />}
                          </span>
                        </th>
                        <td className="p-3 align-top">{offer.scope.label}</td>
                        <td className="p-3 align-top">{offer.kind === "free" ? "—" : formatDuration(offer.duration)}</td>
                        <td className="p-3 align-top">{offer.kind === "subscription" ? "Manuel" : "Aucun"}</td>
                        <td className="max-w-[16rem] p-3 align-top text-ink-muted">{offer.restrictions.join(" ") || "—"}</td>
                        <td className="whitespace-nowrap p-3 text-right align-top font-semibold">{formatMoney(offer.price)}</td>
                        <td className="p-3 align-top">
                          <Badge tone={s.tone}>{s.text}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>

          <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {selectedOffer ? (
                  <>
                    Sélection : <strong className="text-ink">{selectedOffer.title}</strong> — {formatMoney(selectedOffer.price)}
                  </>
                ) : (
                  "Sélectionnez une offre pour continuer."
                )}
              </p>
              {selectedOffer?.kind === "free" ? (
                <Button type="button" variant="outline" onClick={() => navigate("/catalogue?prix=free")}>
                  Voir les contenus gratuits
                </Button>
              ) : (
                <Button type="submit" disabled={!canContinue}>
                  Continuer avec cette offre
                </Button>
              )}
            </div>
            {selectedElig && !selectedElig.can_purchase && selectedElig.blocking_reason === "ALREADY_OWNED" && (
              <p className="mt-2 text-sm text-brand-strong">Vous disposez déjà de cet accès : aucune commande n'est nécessaire.</p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
