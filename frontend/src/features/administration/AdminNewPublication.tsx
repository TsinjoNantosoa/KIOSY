import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { brand } from "@/config/app";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { dateInputToIso, editionSchema, publicationSchema, splitTags } from "./editorialForms";
import { useAdminKey, useAdminQuery } from "./shared";

const schema = publicationSchema.merge(editionSchema);
type Values = typeof schema._type;

export default function AdminNewPublication({ workspace = "admin" }: { workspace?: "admin" | "publisher" }) {
  const base = workspace === "publisher" ? "/publisher/publications" : "/admin/catalogue";
  useDocumentTitle(`Nouvelle publication · ${brand.name}`);
  const navigate = useNavigate();
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const publishers = useAdminQuery(["publishers"], ({ signal }) => api.admin.publishers({ signal }));
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", author: "", publisher_id: "", universe: "presse", language: "fr", summary: "", tags: "", label: "", format: "text", published_at: new Date().toISOString().slice(0, 10), public_excerpt: true, ai_indexing: false, is_free: false },
  });
  const create = useMutation({
    mutationFn: (v: Values) =>
      api.admin.createPublication({
        title: v.title,
        author: v.author,
        publisher_id: v.publisher_id,
        universe: v.universe,
        language: v.language,
        summary: v.summary,
        tags: splitTags(v.tags),
        edition: { label: v.label, format: v.format, published_at: dateInputToIso(v.published_at), permissions: { public_excerpt: v.public_excerpt, ai_indexing: v.ai_indexing, full_text_public: v.is_free }, is_free: v.is_free },
      }),
    onSuccess: (row) => {
      client.invalidateQueries({ queryKey: adminKey("editions") });
      navigate(`${base}/${row.edition.id}`, { replace: true });
    },
  });
  const e = form.formState.errors;
  return (
    <div>
      <PageHeader title="Nouvelle publication" back={{ to: base, label: "Catalogue" }} />
      <Alert tone="info" className="mb-6">La publication est créée en brouillon. Importez ensuite son fichier, puis faites-la passer en revue avant publication.</Alert>
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate className="space-y-6">
        <Card>
          <CardTitle>Publication</CardTitle>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <Field label="Titre" error={e.title?.message} required><Input {...form.register("title")} /></Field>
            <Field label="Auteur" error={e.author?.message} required><Input {...form.register("author")} /></Field>
            <Field label="Éditeur" error={e.publisher_id?.message} required>
              <Select {...form.register("publisher_id")}>
                <option value="">Choisir…</option>
                {(publishers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Univers" required>
              <Select {...form.register("universe")}>{(["presse", "business", "culture"] as const).map((u) => <option key={u} value={u}>{t.universe[u]}</option>)}</Select>
            </Field>
            <Field label="Langue du contenu" hint="Stockée dès le MVP ; l'interface reste en français." required>
              <Select {...form.register("language")}>{(["fr", "mg", "en"] as const).map((l) => <option key={l} value={l}>{t.language[l]}</option>)}</Select>
            </Field>
            <Field label="Mots-clés" hint="Séparés par des virgules (8 maximum)." error={e.tags?.message}><Input {...form.register("tags")} /></Field>
            <Field label="Résumé" error={e.summary?.message} required className="md:col-span-2"><Textarea rows={3} {...form.register("summary")} /></Field>
          </div>
        </Card>
        <Card>
          <CardTitle>Première édition</CardTitle>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
            <Field label="Libellé" hint="Ex. « N° 12 » ou « Octobre 2026 »." error={e.label?.message} required><Input {...form.register("label")} /></Field>
            <Field label="Format" required>
              <Select {...form.register("format")}><option value="text">{t.format.text}</option><option value="pdf">{t.format.pdf}</option></Select>
            </Field>
            <Field label="Date de publication" error={e.published_at?.message} required><Input type="date" {...form.register("published_at")} /></Field>
          </div>
          <fieldset className="mt-4 space-y-2">
            <legend className="mb-1 text-sm font-semibold">Permissions de diffusion (distinctes)</legend>
            <Checkbox label="Extrait public autorisé" {...form.register("public_excerpt")} />
            <Checkbox label="Indexation du texte intégral pour la recherche IA autorisée" {...form.register("ai_indexing")} />
            <Checkbox label="Édition gratuite (lecture publique du texte intégral)" {...form.register("is_free")} />
          </fieldset>
        </Card>
        {create.error && <InlineError error={create.error} />}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <ButtonLink to={base} variant="outline">Annuler</ButtonLink>
          <Button type="submit" loading={create.isPending}>Créer en brouillon</Button>
        </div>
      </form>
    </div>
  );
}
