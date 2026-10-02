import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { appConfig, brand } from "@/config/app";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, timeZoneLabel } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { beginLogout } from "@/features/auth/guards";
import { useLogout, useSession } from "@/features/auth/session";

const schema = z.object({
  display_name: z.string().trim().min(2, "Au moins 2 caractères.").max(60),
  time_zone: z.string().min(1),
});

export default function ProfilePage() {
  useDocumentTitle(`Profil · ${brand.name}`);
  const { user } = useSession();
  const client = useQueryClient();
  const { notify } = useToast();
  const navigate = useNavigate();
  const logout = useLogout();
  const uid = user?.id ?? "anon";
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: { display_name: user?.display_name ?? "", time_zone: user?.preferences.time_zone ?? appConfig.defaultTimeZone },
  });
  const save = useMutation({
    mutationFn: api.auth.updatePreferences,
    onSuccess: (session) => {
      client.setQueryData(qk.session, session);
      notify("Préférences enregistrées.");
    },
  });
  const sessions = useQuery({ queryKey: qk.sessions(uid), queryFn: ({ signal }) => api.auth.listSessions({ signal }) });
  const revoke = useMutation({
    mutationFn: api.auth.revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sessions(uid) }),
  });
  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" />
      <Card>
        <CardTitle>Informations</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          Adresse de connexion : <strong className="text-ink">{user.email}</strong> · Rôle : {user.roles.map((r) => t.role[r]).join(", ")}
        </p>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Nom affiché" error={form.formState.errors.display_name?.message} required>
            <Input {...form.register("display_name")} />
          </Field>
          <Field label="Fuseau horaire d'affichage" hint="Les dates sont enregistrées en UTC et affichées dans ce fuseau.">
            <Select {...form.register("time_zone")}>
              {appConfig.timeZones.map((tz) => <option key={tz} value={tz}>{timeZoneLabel(tz)}</option>)}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <p className="text-sm text-ink-muted">
              Langue de l'interface : <strong className="text-ink">{t.language.fr}</strong>. Le malgache et l'anglais seront proposés après traduction et relecture par des locuteurs compétents.
            </p>
          </div>
          {save.error && <div className="md:col-span-2"><InlineError error={save.error} /></div>}
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" loading={save.isPending}>{t.common.save}</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Sessions ouvertes</CardTitle>
        {sessions.isPending ? (
          <LoadingBlock lines={2} />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-line">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{s.device_label} {s.current && <Badge tone="brand">Session actuelle</Badge>}</p>
                  <p className="text-xs text-ink-muted">Dernière activité : {formatDateTime(s.last_seen_at, user.preferences.time_zone)}</p>
                </div>
                {s.current ? (
                  <Button variant="outline" size="sm" loading={logout.isPending} onClick={() => {
                      beginLogout();
                      navigate("/", { replace: true });
                      logout.mutate();
                    }}>
                    Se déconnecter
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    Fermer cette session
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {revoke.error && <InlineError error={revoke.error} />}
      </Card>

      <Card>
        <CardTitle>Vos données</CardTitle>
        <p className="text-sm leading-6 text-ink-muted">
          Pour exporter ou supprimer vos données, ouvrez une demande d'assistance de catégorie « Autre ». Certaines preuves de transaction peuvent être conservées selon les obligations applicables, puis pseudonymisées.
        </p>
      </Card>
    </div>
  );
}
