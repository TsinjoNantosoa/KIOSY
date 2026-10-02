import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { brand } from "@/config/app";
import { SupportStatusBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/Button";
import { ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Textarea } from "@/components/ui/Form";
import { Card, PageHeader } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid, useTimeZone } from "@/features/auth/session";
import { CaseThread } from "./CaseThread";

export default function SupportDetailPage() {
  const { caseId = "" } = useParams();
  const uid = useUid();
  const tz = useTimeZone();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: qk.supportCase(uid, caseId), queryFn: ({ signal }) => api.support.get(caseId, { signal }) });
  const [body, setBody] = useState("");
  const { keyFor, reset } = useIdempotencyKey();
  const reply = useMutation({
    mutationFn: () => api.support.reply(caseId, body.trim(), { idempotencyKey: keyFor({ caseId, body: body.trim() }) }),
    onSuccess: (updated) => {
      client.setQueryData(qk.supportCase(uid, caseId), updated);
      client.invalidateQueries({ queryKey: qk.cases(uid) });
      setBody("");
      reset();
    },
  });
  useDocumentTitle(`${detail.data?.reference ?? "Demande"} · ${brand.name}`);
  if (detail.isPending) return <LoadingBlock lines={6} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const c = detail.data;
  return (
    <div className="space-y-6">
      <PageHeader title={c.subject} eyebrow={`${c.reference} · ${t.supportCategory[c.category]}`} back={{ to: "/compte/assistance", label: "Mes demandes" }} actions={<SupportStatusBadge status={c.status} />} />
      {(c.related.order_id || c.related.subscription_id || c.related.edition_id) && (
        <p className="text-sm text-ink-muted">
          Éléments liés :{" "}
          {c.related.order_id && <Link to={`/compte/commandes/${c.related.order_id}`} className="text-brand underline">commande</Link>}
          {c.related.subscription_id && <> · <Link to={`/compte/abonnements/${c.related.subscription_id}`} className="text-brand underline">abonnement</Link></>}
          {c.related.edition_id && <> · <Link to={`/lire/${c.related.edition_id}`} className="text-brand underline">contenu</Link></>}
        </p>
      )}
      <CaseThread supportCase={c} timeZone={tz} viewer="reader" />
      {c.status !== "closed" ? (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim().length >= 2 && !reply.isPending) reply.mutate();
            }}
            className="space-y-3"
          >
            <Field label="Votre réponse">
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
            </Field>
            {reply.error && <InlineError error={reply.error} />}
            <div className="flex justify-end">
              <Button type="submit" loading={reply.isPending} disabled={body.trim().length < 2}>Envoyer</Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Cette demande est clôturée.</p>
      )}
    </div>
  );
}
