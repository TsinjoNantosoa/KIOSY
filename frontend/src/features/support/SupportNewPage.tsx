import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { brand } from "@/config/app";
import type { SupportCategory } from "@/contracts/models";
import { Button, ButtonLink } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Card, PageHeader } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";

const CATEGORIES = Object.keys(t.supportCategory) as SupportCategory[];
const schema = z.object({
  category: z.enum(["access", "payment", "subscription", "content", "other"]),
  subject: z.string().trim().min(5, "5 caractères minimum.").max(120, "120 caractères maximum."),
  body: z.string().trim().min(10, "Décrivez le problème en quelques mots (10 caractères minimum).").max(2000, "2000 caractères maximum."),
  order_id: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function SupportNewPage() {
  useDocumentTitle(`Nouvelle demande · ${brand.name}`);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const uid = useUid();
  const client = useQueryClient();
  const orders = useQuery({ queryKey: qk.orders(uid), queryFn: ({ signal }) => api.me.orders({ signal }) });
  const { keyFor } = useIdempotencyKey();
  const preOrder = params.get("commande") ?? "";
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { category: preOrder ? "payment" : "access", subject: "", body: "", order_id: preOrder },
  });
  const create = useMutation({
    mutationFn: (v: Values) => {
      const input = { category: v.category, subject: v.subject, body: v.body, order_id: v.order_id || null };
      return api.support.create(input, { idempotencyKey: keyFor(input) });
    },
    onSuccess: (c) => {
      client.invalidateQueries({ queryKey: qk.cases(uid) });
      navigate(`/compte/assistance/${c.id}`, { replace: true });
    },
  });
  const e = form.formState.errors;
  return (
    <div>
      <PageHeader title="Nouvelle demande d'assistance" back={{ to: "/compte/assistance", label: "Mes demandes" }} />
      <Card>
        <form onSubmit={form.handleSubmit((v) => !create.isPending && create.mutate(v))} noValidate className="space-y-4">
          <Field label="Catégorie" required>
            <Select {...form.register("category")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t.supportCategory[c]}</option>)}
            </Select>
          </Field>
          <Field label="Commande concernée" hint="Facultatif">
            <Select {...form.register("order_id")}>
              <option value="">Aucune</option>
              {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.reference} — {o.lines[0]?.label}</option>)}
            </Select>
          </Field>
          <Field label="Objet" error={e.subject?.message} required>
            <Input {...form.register("subject")} maxLength={120} />
          </Field>
          <Field label="Description" hint="N'indiquez ni mot de passe ni numéro de carte." error={e.body?.message} required>
            <Textarea rows={6} {...form.register("body")} maxLength={2000} />
          </Field>
          {create.error && <InlineError error={create.error} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ButtonLink to="/compte/assistance" variant="outline">Annuler</ButtonLink>
            <Button type="submit" loading={create.isPending}>Envoyer la demande</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
