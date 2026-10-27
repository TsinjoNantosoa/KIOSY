import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Card, PageHeader } from "@/components/ui/Layout";
import { api } from "@/services/api";
import { t } from "@/locales";
import { dateInputToIso, editionSchema, type EditionValues } from "./editorialForms";
import { useAdminKey } from "./shared";

export default function AdminNewEdition({ workspace = "admin" }: { workspace?: "admin" | "publisher" }) {
  const base = workspace === "publisher" ? "/publisher/publications" : "/admin/catalogue";
  const [params] = useSearchParams();
  const publicationId = params.get("publication") ?? "";
  const navigate = useNavigate();
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const form = useForm<EditionValues>({ resolver: zodResolver(editionSchema), defaultValues: { label: "", format: "pdf", published_at: new Date().toISOString().slice(0, 10), public_excerpt: true, ai_indexing: false, is_free: false } });
  const create = useMutation({
    mutationFn: (value: EditionValues) => api.admin.createEdition(publicationId, { label: value.label, format: value.format, published_at: dateInputToIso(value.published_at), permissions: { public_excerpt: value.public_excerpt, ai_indexing: value.ai_indexing, full_text_public: value.is_free }, is_free: value.is_free }),
    onSuccess: (row) => { client.invalidateQueries({ queryKey: adminKey("editions") }); navigate(`${base}/${row.edition.id}`, { replace: true }); },
  });
  const errors = form.formState.errors;
  return <div className="space-y-6"><PageHeader title="Nouvelle édition" back={{ to: "/admin/catalogue", label: "Catalogue" }} /><Alert tone="info">L'édition est ajoutée en brouillon sans modifier ni remplacer les éditions précédentes.</Alert><Card><form onSubmit={form.handleSubmit((value) => create.mutate(value))} className="space-y-4"><Field label="Libellé" error={errors.label?.message} required><Input {...form.register("label")} /></Field><Field label="Format" required><Select {...form.register("format")}><option value="text">{t.format.text}</option><option value="pdf">{t.format.pdf}</option></Select></Field><Field label="Date de publication" error={errors.published_at?.message} required><Input type="date" {...form.register("published_at")} /></Field><fieldset className="space-y-2"><legend className="font-medium">Permissions</legend><Checkbox label="Extrait public autorisé" {...form.register("public_excerpt")} /><Checkbox label="Indexation IA autorisée" {...form.register("ai_indexing")} /><Checkbox label="Édition gratuite" {...form.register("is_free")} /></fieldset>{!publicationId && <Alert tone="danger">La publication cible est absente.</Alert>}{create.error && <InlineError error={create.error} />}<div className="flex justify-end gap-3"><ButtonLink to="/admin/catalogue" variant="outline">Annuler</ButtonLink><Button type="submit" disabled={!publicationId} loading={create.isPending}>Créer l'édition</Button></div></form></Card></div>;
}
