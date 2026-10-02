import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { brand } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import type { Quote } from "@/contracts/models";
import { RESERVATION_DURATION_MS } from "@/contracts/rules";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, EmptyState, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Checkbox } from "@/components/ui/Form";
import { Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";
import { renewalLabel } from "@/features/offers/OfferCard";

export default function CheckoutPage() {
  useDocumentTitle(`Récapitulatif de commande · ${brand.name}`);
  const [params] = useSearchParams();
  const offerId = params.get("offre") ?? "";
  const renewalOf = params.get("renouvellement");
  const uid = useUid();
  const quote = useQuery({
    queryKey: qk.quote(uid, offerId, renewalOf),
    queryFn: ({ signal }) => api.commerce.quote({ offer_id: offerId, renewal_of_subscription_id: renewalOf }, { signal }),
    enabled: Boolean(offerId),
    staleTime: 0,
  });
  const refreshQuote = quote.refetch;

  if (!offerId) {
    return (
      <div className="container max-w-3xl py-10">
        <EmptyState title="Aucune offre sélectionnée" action={<ButtonLink to="/offres">Voir les offres</ButtonLink>} />
      </div>
    );
  }
  return (
    <div className="container max-w-3xl py-8 md:py-12">
      <PageHeader title={renewalOf ? "Renouveler l'abonnement" : "Récapitulatif de commande"} back={{ to: "/offres", label: "Offres" }} />
      <Steps current={1} />
      {quote.isPending ? (
        <LoadingBlock lines={8} />
      ) : quote.isError ? (
        <ErrorState error={quote.error} onRetry={() => quote.refetch()} />
      ) : (
        <QuoteView quote={quote.data} onRefresh={refreshQuote} refreshing={quote.isFetching} />
      )}
    </div>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Récapitulatif", "Paiement", "Accès"];
  return (
    <ol className="mb-8 flex gap-2 text-sm" aria-label="Étapes de la commande">
      {steps.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} aria-current={n === current ? "step" : undefined} className={`flex flex-1 items-center gap-2 border-t-4 pt-2 ${n <= current ? "border-brand font-medium text-ink" : "border-line text-ink-subtle"}`}>
            <span className="hidden sm:inline">{n}.</span> {label}
          </li>
        );
      })}
    </ol>
  );
}

function QuoteView({ quote, onRefresh, refreshing }: { quote: Quote; onRefresh: () => void; refreshing: boolean }) {
  const tz = useTimeZone();
  const navigate = useNavigate();
  const client = useQueryClient();
  const uid = useUid();
  const materialVersion = JSON.stringify({ version: quote.offer.version, conditions: quote.offer.conditions_version, total: quote.total });
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const accepted = acceptedFor === materialVersion;
  const previousMaterial = useRef(materialVersion);
  const [changedMessage, setChangedMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => Date.parse(quote.quote_expires_at) <= Date.now());
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const submitting = useRef(false);
  const { offer, eligibility } = quote;
  const { keyFor, reset } = useIdempotencyKey(uid, `create-order:${offer.id}`);
  const intent = { quote_id: quote.quote_id, offer_id: offer.id, offer_version: offer.version, renewal_of_subscription_id: quote.renewal_of_subscription_id, accepted_conditions_version: offer.conditions_version };

  useEffect(() => {
    if (previousMaterial.current !== materialVersion) {
      const previous = JSON.parse(previousMaterial.current) as { version: number; conditions: string; total: Quote["total"] };
      const changes = [
        previous.version !== offer.version ? `version v${previous.version} → v${offer.version}` : null,
        previous.conditions !== offer.conditions_version ? `conditions ${previous.conditions} → ${offer.conditions_version}` : null,
        JSON.stringify(previous.total) !== JSON.stringify(quote.total) ? `montant ${formatMoney(previous.total)} → ${formatMoney(quote.total)}` : null,
      ].filter(Boolean);
      setChangedMessage(`Le devis a changé (${changes.join(", ")}). Relisez-le et acceptez à nouveau les conditions.`);
      setAcceptedFor(null);
      reset();
      previousMaterial.current = materialVersion;
    }
  }, [materialVersion, offer.conditions_version, offer.version, quote.total, reset]);

  useEffect(() => {
    setExpired(false);
    const delay = Date.parse(quote.quote_expires_at) - Date.now();
    if (delay <= 0) {
      setExpired(true);
      void onRefresh();
      return;
    }
    const timer = window.setTimeout(() => {
      setExpired(true);
      void onRefresh();
    }, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [quote.quote_expires_at, onRefresh]);

  const create = useMutation({
    mutationFn: () => api.commerce.createOrder(intent, { idempotencyKey: keyFor(intent) }),
    onSuccess: (order) => {
      reset();
      client.invalidateQueries({ queryKey: qk.me(uid) });
      navigate(`/commande/${order.id}`, { replace: true });
    },
    onError: (error) => {
      // Un refus métier impose une nouvelle intention ; une erreur réseau garde la même clé.
      if (isApiError(error) && error.kind !== "network" && error.kind !== "unavailable") {
        reset();
        if (error.kind === "conflict") {
          setAcceptedFor(null);
          onRefresh();
        }
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const confirm = () => {
    if (submitting.current || create.isPending) return; // protection contre le double clic (confort, pas sécurité)
    if (expired || refreshing) return;
    if (!accepted) {
      setAcceptError("Confirmez avoir pris connaissance des conditions.");
      return;
    }
    submitting.current = true;
    create.mutate();
  };

  const code = isApiError(create.error) ? create.error.code : null;
  const blocking = eligibility.blocking_reason;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{t.offerKind[offer.kind]}</Badge>
          {offer.is_demo && <DemoBadge label="Prix fictif" />}
        </div>
        <h2 className="mt-3 font-serif text-2xl font-semibold">{offer.title}</h2>
        <p className="mt-1 text-ink-muted">{offer.description}</p>
        <DefinitionList
          className="mt-4"
          items={[
            { term: "Contenu inclus", value: offer.scope.label },
            { term: "Durée d'accès", value: formatDuration(offer.duration) },
            {
              term: "Période",
              value: quote.access_ends_at
                ? `Du ${formatDate(quote.access_starts_at, tz)} au ${formatDate(quote.access_ends_at, tz)}, après confirmation du paiement`
                : "À partir de la confirmation du paiement",
            },
            { term: "Renouvellement", value: renewalLabel(offer) },
            { term: "Restrictions", value: offer.restrictions.length ? <ul className="list-disc pl-5">{offer.restrictions.map((r) => <li key={r}>{r}</li>)}</ul> : "Aucune" },
            ...(offer.quota
              ? [{ term: "Quantité limitée", value: `Une place vous sera réservée pendant ${Math.round(RESERVATION_DURATION_MS / 60000)} minutes après confirmation. L'attribution définitive est décidée par le serveur.` }]
              : []),
          ]}
        />
        <div className="mt-4 border-t border-line pt-4">
          {quote.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4 text-sm">
              <span>{line.label}</span>
              <span>{formatMoney(line.amount)}</span>
            </div>
          ))}
          <div className="mt-3 flex items-baseline justify-between gap-4">
            <span className="font-semibold">Total à payer</span>
            <span className="text-2xl font-semibold">{formatMoney(quote.total)}</span>
          </div>
          <p className="mt-1 text-right text-xs text-ink-subtle">
            Montant calculé par le serveur, en {quote.total.currency}. Aucun paiement n'est effectué à cette étape.
          </p>
        </div>
      </Card>

      {eligibility.overlaps.map((o) => (
        <Alert key={o.entitlement_id} tone="info" title="Chevauchement avec vos accès">
          {o.description}
        </Alert>
      ))}

      {blocking === "ALREADY_OWNED" ? (
        <Alert tone="success" title="Vous disposez déjà de cet accès">
          Aucune commande n'est nécessaire.{" "}
          <Link to={offer.kind === "subscription" ? "/compte/abonnements" : "/compte/bibliotheque"} className="font-medium underline">
            {offer.kind === "subscription" ? "Voir mes abonnements (renouvellement possible depuis l'abonnement)" : "Ouvrir ma bibliothèque"}
          </Link>
        </Alert>
      ) : blocking === "PENDING_ORDER" ? (
        <Alert tone="warning" title="Une commande est déjà en attente de paiement">
          Pour éviter un double paiement, reprenez la commande existante.{" "}
          <Link to={`/commande/${eligibility.pending_order_id}`} className="font-medium underline">Reprendre la commande</Link>
        </Alert>
      ) : blocking === "OFFER_SOLD_OUT" ? (
        <Alert tone="danger" title="Offre épuisée">Toutes les places de cette offre ont été attribuées.</Alert>
      ) : blocking === "OFFER_UNAVAILABLE" ? (
        <Alert tone="danger" title="Offre indisponible">{offer.status_reason ?? "Cette offre ne peut plus être commandée."}</Alert>
      ) : blocking === "FREE_CONTENT" ? (
        <Alert tone="info" title="Contenu gratuit">Aucune commande n'est nécessaire.</Alert>
      ) : (
        <Card>
          <Checkbox
            checked={accepted}
            onChange={(e) => {
              setAcceptedFor(e.target.checked ? materialVersion : null);
              setAcceptError(null);
            }}
            error={acceptError ?? undefined}
            label={
              <>
                J'ai lu les <Link to={`/conditions/vente?version=${encodeURIComponent(offer.conditions_version)}`} target="_blank" className="text-brand underline">conditions de vente</Link> (version {offer.conditions_version}, provisoires) et je comprends que le renouvellement éventuel est manuel.
              </>
            }
          />
          {changedMessage && <Alert tone="warning" title="Devis actualisé" className="mt-4" role="alert">{changedMessage}</Alert>}
          {expired && <Alert tone="warning" title="Devis expiré" className="mt-4" role="alert">La validité de ce devis doit être vérifiée par le serveur. La confirmation reste bloquée pendant son actualisation.</Alert>}
          {code === "OFFER_CHANGED" ? (
            <Alert tone="warning" title="L'offre a changé" className="mt-4" role="alert">
              Le prix ou les conditions ont été modifiés. Le récapitulatif a été rechargé : vérifiez-le avant de confirmer.
            </Alert>
          ) : code === "OFFER_SOLD_OUT" ? (
            <Alert tone="danger" title="Plus de place disponible" className="mt-4" role="alert">
              La dernière place vient d'être attribuée à une autre commande.
            </Alert>
          ) : isApiError(create.error) && (create.error.kind === "network" || create.error.kind === "unavailable") ? (
            <Alert tone="warning" title="Résultat inconnu" className="mt-4" role="alert">
              Nous n'avons pas reçu la réponse du serveur. Vous pouvez réessayer sans risque : la même demande est renvoyée et ne créera pas de seconde commande.
            </Alert>
          ) : (
            create.error && <div className="mt-4"><InlineError error={create.error} /></div>
          )}
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ButtonLink to="/offres" variant="outline">Annuler</ButtonLink>
            <Button onClick={confirm} loading={create.isPending} disabled={refreshing || expired} icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
              Confirmer la commande — {formatMoney(quote.total)}
            </Button>
          </div>
          <p className="mt-3 text-right text-xs text-ink-subtle">Étape suivante : ouverture du prestataire de paiement. Son mode (test, sandbox ou réel) sera indiqué par la réponse du serveur.</p>
        </Card>
      )}
    </div>
  );
}
