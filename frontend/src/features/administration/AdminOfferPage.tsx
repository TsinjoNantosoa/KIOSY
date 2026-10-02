import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { brand } from "@/config/app";
import type { Offer } from "@/contracts/models";
import { Button } from "@/components/ui/Button";
import { Alert, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { OfferStatus } from "./AdminOffers";
import { DataTable, useAdminKey, useAdminQuery } from "./shared";

const schema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(400),
  price_amount: z.coerce.number({ invalid_type_error: "Montant entier attendu." }).int("Montant entier attendu.").min(0, "Montant positif."),
  restrictions: z.string().max(800),
  status: z.enum(["active", "unavailable"]),
});
type Values = z.input<typeof schema>;

export default function AdminOfferPage() {
  const { offerId = "" } = useParams();
  const offers = useAdminQuery(["offers"], ({ signal }) => api.admin.offers({ signal }));
  const offer = offers.data?.find((o) => o.id === offerId);
  useDocumentTitle(`${offer?.title ?? "Offre"} · Administration · ${brand.name}`);
  if (offers.isPending) return <LoadingBlock lines={6} />;
  if (offers.isError) return <ErrorState error={offers.error} onRetry={() => offers.refetch()} />;
  if (!offer) return <ErrorState error={new Error("introuvable")} title="Offre introuvable" />;
  return <OfferEditor key={`${offer.id}-${offer.version}`} offer={offer} />;
}

function OfferEditor({ offer }: { offer: Offer }) {
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const { notify } = useToast();
  const versions = useAdminQuery(["offer-versions", offer.id, offer.version], ({ signal }) => api.admin.offerVersions(offer.id, { signal }));
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: offer.title, description: offer.description, price_amount: offer.price.amount, restrictions: offer.restrictions.join("\n"), status: offer.status === "active" ? "active" : "unavailable" },
  });
  const save = useMutation({
    mutationFn: (v: Values) => {
      const parsed = schema.parse(v);
      return api.admin.updateOffer(offer.id, { ...parsed, restrictions: parsed.restrictions.split("\n").map((r) => r.trim()).filter(Boolean), version: offer.version });
    },
    onSuccess: (updated) => {
      notify(`Version ${updated.version} enregistrée.`);
      client.invalidateQueries({ queryKey: adminKey("offers") });
      client.invalidateQueries({ queryKey: ["offers"] });
      client.invalidateQueries({ queryKey: ["publication"] });
    },
  });
  const e = form.formState.errors;
  return (
    <div className="space-y-6">
      <PageHeader title={offer.title} eyebrow={`Version actuelle v${offer.version}`} back={{ to: "/admin/offres", label: "Offres" }} actions={<OfferStatus offer={offer} />} />
      <Alert tone="info">
        Montants en <strong>{offer.price.currency}</strong>, entiers, échelle {offer.price.scale} (ex. 15000 = {formatMoney({ ...offer.price, amount: 15000 })}). Un lecteur en train de commander verra « l'offre a changé » et devra reconfirmer.
      </Alert>
      <Card>
        <CardTitle>Nouvelle version</CardTitle>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Titre" error={e.title?.message} required><Input {...form.register("title")} /></Field>
          <Field label={`Prix (${offer.price.currency}, entier)`} error={e.price_amount?.message} required>
            <Input type="number" inputMode="numeric" step={1} min={0} disabled={offer.kind === "free"} {...form.register("price_amount")} />
          </Field>
          <Field label="Description" error={e.description?.message} required className="md:col-span-2"><Textarea rows={2} {...form.register("description")} /></Field>
          <Field label="Restrictions" hint="Une par ligne." className="md:col-span-2"><Textarea rows={3} {...form.register("restrictions")} /></Field>
          <Field label="Statut" required>
            <Select {...form.register("status")}><option value="active">Active</option><option value="unavailable">Indisponible</option></Select>
          </Field>
          {save.error && <div className="md:col-span-2"><InlineError error={save.error} /></div>}
          <div className="flex items-end justify-end md:col-span-1"><Button type="submit" loading={save.isPending}>Publier la version {offer.version + 1}</Button></div>
        </form>
      </Card>
      <Card>
        <CardTitle>Historique des versions</CardTitle>
        {versions.isPending ? <LoadingBlock lines={2} /> : versions.isError ? <ErrorState error={versions.error} /> : (
          <DataTable caption="Versions" rows={versions.data} rowKey={(v) => String(v.version)} columns={[
            { header: "Version", primary: true, cell: (v) => `v${v.version}` },
            { header: "Titre", cell: (v) => v.title },
            { header: "Prix", cell: (v) => formatMoney(v.price) },
            { header: "Statut", cell: (v) => <OfferStatus offer={v} /> },
          ]} />
        )}
      </Card>
    </div>
  );
}
