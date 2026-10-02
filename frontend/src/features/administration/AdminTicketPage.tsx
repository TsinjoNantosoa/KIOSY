import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { brand } from "@/config/app";
import type { SupportCase, SupportStatus } from "@/contracts/models";
import { SupportStatusBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/Button";
import { ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { t } from "@/locales";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { CaseThread } from "@/features/support/CaseThread";
import { useAdminKey, useAdminQuery } from "./shared";

export default function AdminTicketPage() {
  const { caseId = "" } = useParams();
  const tz = useTimeZone();
  const detail = useAdminQuery(["case", caseId], ({ signal }) => api.admin.supportCase(caseId, { signal }));
  useDocumentTitle(`${detail.data?.reference ?? "Ticket"} · ${brand.name}`);
  if (detail.isPending) return <LoadingBlock lines={6} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const c = detail.data;
  return (
    <div className="space-y-6">
      <PageHeader title={c.subject} eyebrow={`${c.reference} · ${t.supportCategory[c.category]} · ${c.requester.label}`} back={{ to: "/admin/tickets", label: "Tickets" }} actions={<SupportStatusBadge status={c.status} />} />
      <p className="text-sm text-ink-muted">
        Consultation limitée aux éléments de ce dossier.{" "}
        <Link to={`/admin/droits?lecteur=${c.requester.id}`} className="text-brand underline">Voir les droits du lecteur</Link>
      </p>
      <CaseThread supportCase={c} timeZone={tz} viewer="staff" />
      <Reply supportCase={c} />
      <AccessException supportCase={c} />
    </div>
  );
}

function Reply({ supportCase }: { supportCase: SupportCase }) {
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SupportStatus>(supportCase.status === "open" ? "in_progress" : supportCase.status);
  const { keyFor, reset } = useIdempotencyKey();
  const reply = useMutation({
    mutationFn: () => api.admin.replySupportCase(supportCase.id, { body, status }, { idempotencyKey: keyFor({ id: supportCase.id, body, status }) }),
    onSuccess: (updated) => {
      client.setQueryData(adminKey("case", supportCase.id), updated);
      client.invalidateQueries({ queryKey: adminKey("cases") });
      setBody("");
      reset();
    },
  });
  return (
    <Card>
      <CardTitle>Répondre</CardTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.isPending) reply.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Message au lecteur"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></Field>
        <Field label="Nouveau statut">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)}>
            {(Object.keys(t.supportStatus) as SupportStatus[]).map((s) => <option key={s} value={s}>{t.supportStatus[s]}</option>)}
          </Select>
        </Field>
        {reply.error && <InlineError error={reply.error} />}
        <div className="flex justify-end"><Button type="submit" loading={reply.isPending}>Envoyer</Button></div>
      </form>
    </Card>
  );
}

function AccessException({ supportCase }: { supportCase: SupportCase }) {
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const { notify } = useToast();
  const editions = useAdminQuery(["public-editions"], ({ signal }) => api.catalog.search({ page_size: 48 }, { signal }));
  const [editionId, setEditionId] = useState(supportCase.related.edition_id ?? "");
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const request = useMutation({
    mutationFn: () => api.admin.requestAccessException(supportCase.id, { reason, edition_id: editionId, days }),
    onSuccess: () => {
      notify("Demande d'approbation transmise à un responsable.");
      setReason("");
      client.invalidateQueries({ queryKey: adminKey("approvals") });
    },
  });
  return (
    <Card>
      <CardTitle>Demander un accès exceptionnel</CardTitle>
      <p className="mb-4 text-sm text-ink-muted">L'accès n'est attribué qu'après approbation par un responsable distinct du demandeur.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!request.isPending) request.mutate();
        }}
        className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2"
      >
        <Field label="Édition" required>
          <Select value={editionId} onChange={(e) => setEditionId(e.target.value)}>
            <option value="">Choisir…</option>
            {editionId && !(editions.data?.items ?? []).some((i) => i.latest_edition.id === editionId) && <option value={editionId}>Édition liée au ticket ({editionId})</option>}
            {(editions.data?.items ?? []).map((i) => <option key={i.latest_edition.id} value={i.latest_edition.id}>{i.publication.title} — {i.latest_edition.label}</option>)}
          </Select>
        </Field>
        <Field label="Durée (jours)" hint="Entre 1 et 30." required>
          <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
        <Field label="Motif" hint="10 caractères minimum, tracé dans l'audit." required className="md:col-span-2">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {request.error && <div className="md:col-span-2"><InlineError error={request.error} /></div>}
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" variant="outline" loading={request.isPending} disabled={!editionId || reason.trim().length < 10}>Demander l'approbation</Button>
        </div>
      </form>
    </Card>
  );
}
