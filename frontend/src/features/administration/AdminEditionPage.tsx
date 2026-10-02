import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { brand } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import type { AdminEditionRow, EditorialStatus } from "@/contracts/models";
import { EDITORIAL_TRANSITIONS } from "@/contracts/rules";
import { EditorialStatusBadge } from "@/components/StatusBadges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { dateInputToIso, editionSchema, isoToDateInput, publicationSchema, splitTags, type EditionValues, type PublicationValues } from "./editorialForms";
import { useAdminKey, useAdminQuery } from "./shared";

const TRANSITION_LABEL: Record<EditorialStatus, string> = {
  draft: "Renvoyer en brouillon",
  review: "Soumettre à revue",
  published: "Publier",
  suspended: "Suspendre (retrait)",
  archived: "Archiver",
};

export default function AdminEditionPage() {
  const { editionId = "" } = useParams();
  const row = useAdminQuery(["edition", editionId], ({ signal }) => api.admin.edition(editionId, { signal }));
  useDocumentTitle(`${row.data?.publication.title ?? "Édition"} · Administration · ${brand.name}`);
  if (row.isPending) return <LoadingBlock lines={8} />;
  if (row.isError) return <ErrorState error={row.error} onRetry={() => row.refetch()} />;
  return <EditionEditor key={`${row.data.edition.id}-${row.data.edition.version}`} row={row.data} onReload={() => row.refetch()} />;
}

function EditionEditor({ row, onReload }: { row: AdminEditionRow; onReload: () => void }) {
  const { edition, publication } = row;
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const { notify } = useToast();
  const publishers = useAdminQuery(["publishers"], ({ signal }) => api.admin.publishers({ signal }));
  const [transition, setTransition] = useState<EditorialStatus | null>(null);
  const [reason, setReason] = useState("");

  const refresh = (updated?: AdminEditionRow) => {
    if (updated) client.setQueryData(adminKey("edition", edition.id), updated);
    client.invalidateQueries({ queryKey: adminKey("editions") });
    client.invalidateQueries({ queryKey: ["catalog"] });
    client.invalidateQueries({ queryKey: ["publication"] });
  };

  const pubForm = useForm<PublicationValues>({
    resolver: zodResolver(publicationSchema),
    defaultValues: { title: publication.title, author: publication.author, publisher_id: publication.publisher.id, universe: publication.universe, language: publication.language, summary: publication.summary, tags: publication.tags.join(", ") },
  });
  const edForm = useForm<EditionValues>({
    resolver: zodResolver(editionSchema),
    defaultValues: { label: edition.label, format: edition.format, published_at: isoToDateInput(edition.published_at), public_excerpt: edition.permissions.public_excerpt, ai_indexing: edition.permissions.ai_indexing, is_free: edition.is_free },
  });

  const savePub = useMutation({
    mutationFn: (v: PublicationValues) => api.admin.updatePublication(publication.id, { ...v, tags: splitTags(v.tags) }),
    onSuccess: () => {
      notify("Publication enregistrée.");
      refresh();
      onReload();
    },
  });
  const saveEd = useMutation({
    mutationFn: (v: EditionValues) =>
      api.admin.updateEdition(edition.id, { label: v.label, format: v.format, published_at: dateInputToIso(v.published_at), permissions: { public_excerpt: v.public_excerpt, ai_indexing: v.ai_indexing, full_text_public: v.is_free }, is_free: v.is_free, version: edition.version }),
    onSuccess: (updated) => {
      notify("Édition enregistrée (nouvelle version).");
      refresh(updated);
    },
  });
  const move = useMutation({
    mutationFn: (to: EditorialStatus) => api.admin.transitionEdition(edition.id, { to, version: edition.version, reason }),
    onSuccess: (updated) => {
      notify(`Statut : ${t.editorialStatus[updated.edition.status]}.`);
      setTransition(null);
      setReason("");
      refresh(updated);
    },
  });
  const conflict = [saveEd.error, move.error].some((e) => isApiError(e) && e.code === "VERSION_CONFLICT");
  const needsReason = transition === "suspended" || transition === "archived";
  const e1 = pubForm.formState.errors;
  const e2 = edForm.formState.errors;

  return (
    <div className="space-y-6">
      <PageHeader title={publication.title} eyebrow={`Édition ${edition.label} · version ${edition.version}`} back={{ to: "/admin/catalogue", label: "Catalogue" }} actions={<div className="flex items-center gap-2"><ButtonLink to={`/admin/catalogue/nouvelle-edition?publication=${publication.id}`} variant="outline">Ajouter une édition</ButtonLink><EditorialStatusBadge status={edition.status} /></div>} />
      {conflict && (
        <Alert tone="warning" title="Modification concurrente" role="alert">
          Cette édition a changé depuis son ouverture. <button type="button" className="font-medium underline" onClick={onReload}>Recharger la version à jour</button>
        </Alert>
      )}

      <Card>
        <CardTitle>Cycle de publication</CardTitle>
        <p className="text-sm text-ink-muted">Transitions autorisées depuis « {t.editorialStatus[edition.status]} » :</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EDITORIAL_TRANSITIONS[edition.status].length === 0 && <p className="text-sm">Aucune (état final).</p>}
          {EDITORIAL_TRANSITIONS[edition.status].map((to) => (
            <Button key={to} variant={to === "published" ? "primary" : to === "suspended" || to === "archived" ? "danger" : "outline"} onClick={() => setTransition(to)}>
              {TRANSITION_LABEL[to]}
            </Button>
          ))}
        </div>
        {!edition.asset_id && (
          <p className="mt-3 text-sm text-caution">Aucun fichier traité : la publication sera refusée. <Link to="/admin/imports" className="font-medium underline">Importer le fichier</Link></p>
        )}
        {edition.status === "published" && <p className="mt-3 text-sm"><Link to={`/publications/${publication.slug}`} className="text-brand underline">Voir la fiche publique</Link></p>}
        {move.error && !conflict && transition === null && <div className="mt-3"><InlineError error={move.error} /></div>}
      </Card>

      <Dialog
        open={transition !== null}
        onOpenChange={(open) => !open && setTransition(null)}
        title={transition ? TRANSITION_LABEL[transition] : ""}
        description={needsReason ? "Un retrait bloque les nouvelles ventes. L'effet sur les accès déjà acquis dépend du contrat et doit être communiqué." : "Confirmez le changement de statut."}
        footer={
          <>
            <Button variant="outline" onClick={() => setTransition(null)}>Annuler</Button>
            <Button variant={needsReason ? "danger" : "primary"} loading={move.isPending} disabled={needsReason && reason.trim().length < 5} onClick={() => transition && move.mutate(transition)}>
              Confirmer
            </Button>
          </>
        }
      >
        {needsReason && (
          <Field label="Motif (tracé dans l'audit)" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {move.error && <div className="mt-3"><InlineError error={move.error} /></div>}
      </Dialog>

      <Card>
        <CardTitle>Édition</CardTitle>
        <form onSubmit={edForm.handleSubmit((v) => saveEd.mutate(v))} noValidate className="space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
            <Field label="Libellé" error={e2.label?.message} required><Input {...edForm.register("label")} /></Field>
            <Field label="Format" required><Select {...edForm.register("format")}><option value="text">{t.format.text}</option><option value="pdf">{t.format.pdf}</option></Select></Field>
            <Field label="Date de publication" error={e2.published_at?.message} required><Input type="date" {...edForm.register("published_at")} /></Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Permissions de diffusion</legend>
            <Checkbox label="Extrait public autorisé" {...edForm.register("public_excerpt")} />
            <Checkbox label="Indexation IA du texte intégral autorisée" {...edForm.register("ai_indexing")} />
            <Checkbox label="Édition gratuite" {...edForm.register("is_free")} />
          </fieldset>
          <p className="text-xs text-ink-subtle">Les commandes passées conservent leur instantané : une modification ne change pas ce qui a été vendu.</p>
          {saveEd.error && !conflict && <InlineError error={saveEd.error} />}
          <div className="flex justify-end"><Button type="submit" loading={saveEd.isPending}>Enregistrer l'édition</Button></div>
        </form>
      </Card>

      <Card>
        <CardTitle>Publication</CardTitle>
        <form onSubmit={pubForm.handleSubmit((v) => savePub.mutate(v))} noValidate className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Titre" error={e1.title?.message} required><Input {...pubForm.register("title")} /></Field>
          <Field label="Auteur" error={e1.author?.message} required><Input {...pubForm.register("author")} /></Field>
          <Field label="Éditeur" required>
            <Select {...pubForm.register("publisher_id")}>{(publishers.data ?? [publication.publisher]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <Field label="Univers" required><Select {...pubForm.register("universe")}>{(["presse", "business", "culture"] as const).map((u) => <option key={u} value={u}>{t.universe[u]}</option>)}</Select></Field>
          <Field label="Langue" required><Select {...pubForm.register("language")}>{(["fr", "mg", "en"] as const).map((l) => <option key={l} value={l}>{t.language[l]}</option>)}</Select></Field>
          <Field label="Mots-clés"><Input {...pubForm.register("tags")} /></Field>
          <Field label="Résumé" error={e1.summary?.message} required className="md:col-span-2"><Textarea rows={3} {...pubForm.register("summary")} /></Field>
          {savePub.error && <div className="md:col-span-2"><InlineError error={savePub.error} /></div>}
          <div className="flex justify-end md:col-span-2"><Button type="submit" loading={savePub.isPending}>Enregistrer la publication</Button></div>
        </form>
      </Card>
    </div>
  );
}
