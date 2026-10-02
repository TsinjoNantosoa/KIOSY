import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { Link } from "react-router-dom";
import type { Eligibility, Offer } from "@/contracts/models";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatDuration, formatMoney } from "@/lib/format";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useSession } from "@/features/auth/session";

/** Éligibilité calculée par le serveur (doublons, chevauchements, disponibilité) pour l'utilisateur connecté. */
export function useEligibility(offerIds: string[]) {
  const { user } = useSession();
  return useQuery({
    queryKey: qk.eligibility(user?.id ?? "anon", offerIds),
    queryFn: ({ signal }) => api.me.eligibility(offerIds, { signal }),
    enabled: Boolean(user) && offerIds.length > 0,
    select: (list) => new Map(list.map((e) => [e.offer_id, e])),
  });
}

export function renewalLabel(offer: Pick<Offer, "renewal" | "kind">): string {
  if (offer.kind !== "subscription") return "Sans renouvellement";
  return "Renouvellement manuel, sans prélèvement automatique";
}

function statusBadge(offer: Offer) {
  if (offer.status === "unavailable" || offer.status === "retired") return <Badge tone="danger">Indisponible</Badge>;
  if (offer.status === "sold_out" || (offer.quota && offer.quota.remaining <= 0)) return <Badge tone="danger">Épuisée</Badge>;
  return null;
}

export function OfferCard({ offer, eligibility, selected, compact = false }: { offer: Offer; eligibility?: Eligibility; selected?: boolean; compact?: boolean }) {
  const { user } = useSession();
  const blocked = offer.status !== "active" || (offer.quota !== null && offer.quota.remaining <= 0);
  const owned = eligibility?.already_owned;
  const pending = eligibility?.blocking_reason === "PENDING_ORDER";
  return (
    <article className={cn("flex h-full flex-col rounded-card border bg-surface p-5 shadow-card", selected ? "border-brand ring-2 ring-brand/30" : "border-line", blocked && "bg-sunken/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={offer.kind === "subscription" ? "brand" : offer.kind === "free" ? "info" : "neutral"}>{t.offerKind[offer.kind]}</Badge>
        {statusBadge(offer)}
        {offer.is_demo && <DemoBadge label="Prix fictif" />}
      </div>
      <h3 className="mt-3 font-serif text-lg font-semibold leading-snug">{offer.title}</h3>
      {!compact && <p className="mt-1 text-sm text-ink-muted">{offer.description}</p>}

      {/* Prix, devise, durée et renouvellement affichés ensemble (UX02). */}
      <p className="mt-4 text-2xl font-semibold">{formatMoney(offer.price)}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 whitespace-nowrap text-ink-muted">Contenu inclus :</dt>
          <dd>{offer.scope.label}</dd>
        </div>
        {offer.kind !== "free" && (
          <div className="flex gap-2">
            <dt className="shrink-0 whitespace-nowrap text-ink-muted">Durée d'accès :</dt>
            <dd>{formatDuration(offer.duration)}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="shrink-0 whitespace-nowrap text-ink-muted">Renouvellement :</dt>
          <dd>{renewalLabel(offer)}</dd>
        </div>
        {offer.quota && (
          <div className="flex gap-2">
            <dt className="shrink-0 whitespace-nowrap text-ink-muted">Quantité limitée :</dt>
            <dd>
              {offer.quota.remaining > 0 ? `${offer.quota.remaining} place(s) restante(s) sur ${offer.quota.total}` : "plus aucune place"}
              <span className="block text-xs text-ink-subtle">Indication non garantie : l'attribution est confirmée par le serveur à la commande.</span>
            </dd>
          </div>
        )}
      </dl>
      {!compact && offer.restrictions.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-muted">
          {offer.restrictions.map((r) => (
            <li key={r} className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      )}
      {offer.status_reason && <p className="mt-3 text-sm font-medium text-danger">{offer.status_reason}</p>}

      <div className="mt-auto space-y-2 pt-5">
        {owned && (
          <p className="flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm font-medium text-brand-strong">
            <Check className="h-4 w-4" aria-hidden /> Vous disposez déjà de cet accès.
          </p>
        )}
        {pending && eligibility?.pending_order_id && (
          <p className="rounded-md bg-caution-soft px-3 py-2 text-sm text-caution">
            Une commande est déjà en attente de paiement.{" "}
            <Link to={`/commande/${eligibility.pending_order_id}`} className="font-medium underline">
              Reprendre la commande
            </Link>
          </p>
        )}
        {eligibility?.overlaps.map((o) => (
          <p key={o.entitlement_id} className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
            {o.description}
          </p>
        ))}
        {offer.kind === "free" ? (
          <ButtonLink to="/catalogue?prix=free" variant="outline" className="w-full">
            Voir les contenus gratuits
          </ButtonLink>
        ) : blocked ? (
          <p className="text-sm text-ink-muted">Cette offre ne peut pas être commandée actuellement.</p>
        ) : owned ? (
          <ButtonLink to="/compte/bibliotheque" variant="outline" className="w-full">
            Aller à ma bibliothèque
          </ButtonLink>
        ) : pending ? null : (
          <ButtonLink to={user ? `/commande?offre=${offer.id}` : `/connexion?retour=${encodeURIComponent(`/commande?offre=${offer.id}`)}`} className="w-full">
            {user ? "Choisir cette offre" : "Se connecter pour commander"}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}
