import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OfferKind, Universe } from "@/contracts/models";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, PageHeader } from "@/components/ui/Layout";
import { api } from "@/services/api";
import { useAdminKey, useAdminQuery } from "./shared";

export default function AdminNewOffer() {
  const editions = useAdminQuery(["editions-for-offer"], ({ signal }) => api.admin.editions({}, { signal }));
  const [kind, setKind] = useState<OfferKind>("single");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState("MGA");
  const [scale, setScale] = useState(0);
  const [durationCount, setDurationCount] = useState(12);
  const [durationUnit, setDurationUnit] = useState<"day" | "month" | "year">("month");
  const [scopeId, setScopeId] = useState("");
  const [universe, setUniverse] = useState<Universe>("presse");
  const [conditions, setConditions] = useState("démo-0.1");
  const [restrictions, setRestrictions] = useState("");
  const [quota, setQuota] = useState("");
  const [status, setStatus] = useState<"active" | "unavailable">("active");
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const create = useMutation({
    mutationFn: () => {
      if (title.trim().length < 3 || description.trim().length < 5 || !conditions.trim()) throw new Error("Renseignez le titre, la description et la version des conditions.");
      if (kind === "single" && !scopeId) throw new Error("Choisissez l'édition incluse.");
      if (!Number.isInteger(amount) || amount < 0 || !Number.isInteger(scale) || scale < 0) throw new Error("Le montant et l'échelle doivent être des entiers positifs.");
      const quotaTotal = quota === "" ? null : Number(quota);
      if (quotaTotal !== null && (!Number.isInteger(quotaTotal) || quotaTotal <= 0)) throw new Error("Le quota doit être un entier strictement positif.");
      const row = editions.data?.find((item) => item.edition.id === scopeId);
      const scope = kind === "single"
        ? { kind: "edition" as const, edition_id: scopeId, publication_id: row?.publication.id ?? "", label: `${row?.publication.title ?? "Édition"} — ${row?.edition.label ?? ""}` }
        : kind === "subscription"
          ? { kind: "collection" as const, universe, label: `Toutes les éditions ${universe}`, includes_future_additions: true }
          : { kind: "free_selection" as const, label: "Sélection gratuite" };
      return api.admin.createOffer({
        kind, title, description, price: { amount: kind === "free" ? 0 : amount, currency, scale },
        duration: kind === "free" ? null : { count: durationCount, unit: durationUnit }, scope,
        restrictions: restrictions.split("\n").map((value) => value.trim()).filter(Boolean),
        conditions_version: conditions.trim(), quota_total: quotaTotal, status,
      });
    },
    onSuccess: (offer) => {
      client.invalidateQueries({ queryKey: adminKey("offers") });
      navigate(`/admin/offres/${offer.id}`, { replace: true });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Création impossible."),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle offre" back={{ to: "/admin/offres", label: "Offres" }} />
      <Alert tone="info">La création produit une version 1. Les commandes futures conserveront ensuite leur instantané.</Alert>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); setFormError(null); create.mutate(); }} className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Type" required><Select value={kind} onChange={(e) => setKind(e.target.value as OfferKind)}><option value="single">Achat à l'unité</option><option value="subscription">Abonnement thématique</option><option value="free">Gratuit</option></Select></Field>
          <Field label="Statut" required><Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="active">Active</option><option value="unavailable">Indisponible</option></Select></Field>
          <Field label="Titre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Version des conditions" required><Input value={conditions} onChange={(e) => setConditions(e.target.value)} /></Field>
          <Field label="Description" required className="md:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {kind === "single" && <Field label="Édition incluse" required className="md:col-span-2"><Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}><option value="">Choisir…</option>{(editions.data ?? []).map((row) => <option key={row.edition.id} value={row.edition.id}>{row.publication.title} — {row.edition.label}</option>)}</Select></Field>}
          {kind === "subscription" && <Field label="Univers inclus" required><Select value={universe} onChange={(e) => setUniverse(e.target.value as Universe)}><option value="presse">Presse</option><option value="business">Business</option><option value="culture">Culture</option></Select></Field>}
          {kind !== "free" && <><Field label="Montant" required><Input type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field><Field label="Devise" required><Input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field><Field label="Unité monétaire (échelle)" required><Input type="number" min={0} max={6} value={scale} onChange={(e) => setScale(Number(e.target.value))} /></Field><Field label="Durée" required><div className="grid grid-cols-2 gap-2"><Input type="number" min={1} value={durationCount} onChange={(e) => setDurationCount(Number(e.target.value))} /><Select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as typeof durationUnit)}><option value="day">jours</option><option value="month">mois</option><option value="year">ans</option></Select></div></Field></>}
          <Field label="Quota facultatif" hint="Vide = contenu non contingenté."><Input type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} /></Field>
          <Field label="Restrictions" hint="Une par ligne." className="md:col-span-2"><Textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} /></Field>
          {(formError || create.error) && <div className="md:col-span-2"><InlineError error={formError ? new Error(formError) : create.error} /></div>}
          <div className="flex justify-end gap-3 md:col-span-2"><ButtonLink to="/admin/offres" variant="outline">Annuler</ButtonLink><Button type="submit" loading={create.isPending}>Créer l'offre</Button></div>
        </form>
      </Card>
    </div>
  );
}
