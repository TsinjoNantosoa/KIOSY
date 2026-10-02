import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { brand } from "@/config/app";
import type { ImportJob } from "@/contracts/models";
import { ImportStatusBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/Button";
import { Alert, ErrorState, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { Field, Select } from "@/components/ui/Form";
import { Card, CardTitle, PageHeader } from "@/components/ui/Layout";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { useIdempotencyKey } from "@/lib/idempotency";
import { api } from "@/services/api";
import { useTimeZone } from "@/features/auth/session";
import { checkFileLocally, type LocalCheck } from "./uploadValidation";
import { DataTable, useAdminKey, useAdminQuery } from "./shared";

const TERMINAL: ImportJob["status"][] = ["ready", "failed"];

export default function AdminImports() {
  useDocumentTitle(`Imports · Administration · ${brand.name}`);
  const tz = useTimeZone();
  const client = useQueryClient();
  const adminKey = useAdminKey();
  const editions = useAdminQuery(["editions", "", ""], ({ signal }) => api.admin.editions({}, { signal }));
  // L'état des traitements vient du serveur : il est retrouvé après un rafraîchissement.
  const jobs = useAdminQuery(["imports"], ({ signal }) => api.admin.imports({ signal }), {
    refetchInterval: (data) => (data?.some((j) => !TERMINAL.includes(j.status)) ? 1500 : false),
  });
  const [file, setFile] = useState<File | null>(null);
  const [editionId, setEditionId] = useState("");
  const [checks, setChecks] = useState<LocalCheck[]>([]);
  const { keyFor, reset } = useIdempotencyKey();
  const upload = useMutation({
    mutationFn: () => api.admin.uploadImport({ file: file!, edition_id: editionId }, { idempotencyKey: keyFor({ name: file!.name, size: file!.size, lastModified: file!.lastModified, editionId }) }),
    onSuccess: () => {
      reset();
      setFile(null);
      setChecks([]);
      client.invalidateQueries({ queryKey: adminKey("imports") });
    },
  });
  const localOk = checks.length > 0 && checks.every((c) => c.ok);

  const onFile = async (f: File | null) => {
    setFile(f);
    setChecks(f ? await checkFileLocally(f) : []);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && editionId && localOk && !upload.isPending) upload.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Imports de fichiers" description="Chaque fichier passe par quarantaine, validation, extraction du texte et indexation avant d'être marqué prêt." />
      <Card>
        <CardTitle>Nouvel import</CardTitle>
        <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Édition concernée" required>
            <Select value={editionId} onChange={(e) => setEditionId(e.target.value)}>
              <option value="">Choisir…</option>
              {(editions.data ?? []).map((r) => <option key={r.edition.id} value={r.edition.id}>{r.publication.title} — {r.edition.label}</option>)}
            </Select>
          </Field>
          <Field label="Fichier" hint="PDF, Markdown ou texte. En démo, un nom contenant « scan » simule un PDF sans texte.">
            <input type="file" accept=".pdf,.md,.txt" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:font-medium" />
          </Field>
          {file && (
            <div className="md:col-span-2">
              <p className="text-sm font-medium">{file.name} · {formatBytes(file.size)}</p>
              <p className="mt-1 text-xs text-ink-subtle">Validation locale indicative — le serveur refera tous les contrôles :</p>
              <ul className="mt-2 space-y-1 text-sm">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    {c.ok ? <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden /> : <XCircle className="h-4 w-4 text-danger" aria-hidden />}
                    <span>{c.label}</span>
                    <span className="sr-only">{c.ok ? "conforme" : "non conforme"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upload.error && <div className="md:col-span-2"><InlineError error={upload.error} /></div>}
          <div className="flex justify-end md:col-span-2">
            <Button type="submit" loading={upload.isPending} disabled={!file || !editionId || !localOk}>Envoyer en quarantaine</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Traitements</CardTitle>
        {jobs.isPending ? (
          <LoadingBlock lines={3} />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : (
          <>
            {jobs.data.some((j) => j.status === "failed") && <Alert tone="warning" className="mb-4">Un fichier en échec n'est jamais marqué prêt ; corrigez-le puis relancez un import.</Alert>}
            <DataTable
              caption="Traitements d'import"
              rows={jobs.data}
              rowKey={(j) => j.id}
              columns={[
                { header: "Fichier", primary: true, cell: (j) => <span className="break-all">{j.file_name}</span> },
                { header: "Édition", cell: (j) => j.edition_label ?? "—" },
                { header: "Progression", cell: (j) => <Progress job={j} /> },
                { header: "Statut", cell: (j) => <ImportStatusBadge status={j.status} /> },
                { header: "Détail", cell: (j) => (j.error ? <span className="text-danger">{j.error.message}</span> : j.status === "ready" ? "Texte extrait et indexé" : "…") },
                { header: "Reçu le", cell: (j) => formatDateTime(j.created_at, tz) },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function Progress({ job }: { job: ImportJob }) {
  return (
    <div className="w-32">
      <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label={`Progression de ${job.file_name}`}>
        <div className={`h-full ${job.status === "failed" ? "bg-danger" : "bg-brand"}`} style={{ width: `${job.progress}%` }} />
      </div>
      <span className="text-xs text-ink-muted">{job.progress} %</span>
    </div>
  );
}
