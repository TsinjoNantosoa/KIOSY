import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { isDemo } from "@/config/app";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/locales";
import { useApplySession, useSession } from "@/features/auth/session";
import { api } from "@/services/api";
import { cn } from "@/lib/cn";

/**
 * Outils réservés au mode démonstration : changement de persona, réinitialisation, panne simulée,
 * expiration de session. Absents du bundle fonctionnel en mode api (isDemo = false).
 */
export function DemoBar({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!isDemo) return null;
  return (
    <div className={cn("border-b border-warm/30 bg-warm-soft text-sm text-ink", compact && "text-xs")}>
      <div className="container flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
        <p className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0 text-warm" aria-hidden />
          <span>
            <strong>Mode démonstration</strong> — contenus, comptes et prix fictifs ; paiements et assistant simulés.
          </span>
        </p>
        <button type="button" className="ml-auto min-h-8 rounded px-2 font-medium text-warm underline underline-offset-2 hover:bg-warm/10" onClick={() => setOpen(true)}>
          Outils de démo
        </button>
      </div>
      {open && <DemoPanel open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function DemoPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useSession();
  const apply = useApplySession();
  const client = useQueryClient();
  const { notify } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<typeof import("@/mocks/demoApi") | null>(null);
  const [outage, setOutage] = useState(false);

  // Chargement paresseux des contrôles de démo.
  useEffect(() => {
    let active = true;
    void import("@/mocks/demoApi").then((mod) => {
      if (!active) return;
      setDemo(mod);
      setOutage(mod.demoControls.isOutage());
    });
    return () => {
      active = false;
    };
  }, []);

  const switchTo = async (email: string) => {
    setBusy(email);
    try {
      const session = await api.auth.login({ email, password: "demo" });
      apply(session);
      notify(`Connecté en tant que ${session.user.display_name}.`);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Outils de démonstration" description="Ces commandes n'existent qu'en mode démo et n'affectent que ce navigateur." size="lg">
      {!demo ? (
        <p className="text-sm text-ink-muted">{t.common.loading}</p>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Personas fictives</h3>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              {demo.demoControls.personas().map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => switchTo(p.email)}
                    disabled={busy !== null}
                    aria-current={user?.id === p.id ? "true" : undefined}
                    className={cn("w-full rounded-md border border-line bg-surface p-3 text-left hover:border-brand disabled:opacity-60", user?.id === p.id && "border-brand bg-brand-soft")}
                  >
                    <span className="block font-medium">{p.display_name}</span>
                    <span className="block text-xs text-ink-muted">{p.roles.map((r) => t.role[r]).join(", ")} · {p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Situations à tester</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={outage ? "danger" : "outline"}
                onClick={() => {
                  demo.demoControls.setOutage(!outage);
                  setOutage(!outage);
                  client.invalidateQueries();
                  notify(!outage ? "Panne du service simulée : les écrans affichent l'état indisponible." : "Service rétabli.", "info");
                }}
              >
                {outage ? "Rétablir le service" : "Simuler une panne du service"}
              </Button>
              <Button
                variant="outline"
                disabled={!user}
                onClick={() => {
                  demo.demoControls.expireSession();
                  client.invalidateQueries({ queryKey: ["me"] });
                  onOpenChange(false);
                }}
              >
                Faire expirer la session
              </Button>
            </div>
          </section>
          <section className="space-y-3">
            <Alert tone="warning" title="Réinitialiser la démonstration">
              Restaure les données fictives d'origine et déconnecte la persona courante.
            </Alert>
            <Button
              variant="danger"
              onClick={async () => {
                const { resetDemoDb, setDemoSessionUserId } = await import("@/mocks/db");
                resetDemoDb();
                setDemoSessionUserId(null);
                client.clear();
                window.location.assign("/");
              }}
            >
              Réinitialiser les données de démo
            </Button>
          </section>
        </div>
      )}
    </Dialog>
  );
}
