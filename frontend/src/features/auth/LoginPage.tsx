import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { brand, isDemo } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import { Button } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Form";
import { Card } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { safeReturnPath } from "./guards";
import { useLogin, useSession } from "./session";

const schema = z.object({
  email: z.string().trim().min(1, "Saisissez votre adresse e-mail.").email("Adresse e-mail invalide."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});
type Values = z.infer<typeof schema>;

const DEMO_ACCOUNTS = import.meta.env.VITE_APP_MODE === "api" ? [] : [
  { email: "hery@demo.kiosy.invalid", label: "Hery — lecteur", detail: "Abonnement Culture actif, un achat, un accès expiré" },
  { email: "fara@demo.kiosy.invalid", label: "Fara — lectrice", detail: "Presse résilié à échéance, paiement incertain, ticket ouvert" },
  { email: "support@demo.kiosy.invalid", label: "Nirina — support", detail: "Tickets et demandes d'approbation" },
  { email: "responsable@demo.kiosy.invalid", label: "Voahangy — responsable", detail: "Approbations et audit" },
  { email: "admin@demo.kiosy.invalid", label: "Tahina — administration", detail: "Catalogue, offres, imports, diagnostic IA" },
];

export default function LoginPage() {
  useDocumentTitle(`Connexion · ${brand.name}`);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status } = useSession();
  const login = useLogin();
  const retour = safeReturnPath(params.get("retour"));
  const expired = params.get("raison") === "session-expiree";
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  if (status === "authenticated" && !login.isPending && !login.isSuccess) return <Navigate to={retour} replace />;

  const submit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(retour, { replace: true }),
    }),
  );

  const credentialsError = isApiError(login.error) && login.error.code === "INVALID_CREDENTIALS";

  return (
    <div className="container grid max-w-5xl gap-8 py-10 md:grid-cols-2 md:py-16">
      <div>
        <h1 className="text-3xl font-semibold">Connexion</h1>
        <p className="mt-2 text-ink-muted">Accédez à votre bibliothèque, vos abonnements et vos demandes.</p>
        {expired && (
          <Alert tone="warning" title="Session expirée" className="mt-6" role="status">
            Pour protéger votre compte, reconnectez-vous. Vous reviendrez ensuite à la page où vous étiez.
          </Alert>
        )}
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          <Field label="Adresse e-mail" error={form.formState.errors.email?.message} required>
            <Input type="email" autoComplete="email" {...form.register("email")} />
          </Field>
          <Field label="Mot de passe" error={form.formState.errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...form.register("password")} />
          </Field>
          {credentialsError ? (
            <Alert tone="danger" role="alert">
              Adresse e-mail ou mot de passe incorrect.
            </Alert>
          ) : (
            login.error && <InlineError error={login.error} />
          )}
          <Button type="submit" className="w-full" loading={login.isPending}>
            Se connecter
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <Link to="/mot-de-passe-oublie" className="text-brand underline underline-offset-2">
              Mot de passe oublié ?
            </Link>
            <Link to={`/inscription?retour=${encodeURIComponent(retour)}`} className="text-brand underline underline-offset-2">
              Créer un compte
            </Link>
          </div>
        </form>
      </div>

      {isDemo && (
        <Card className="self-start bg-warm-soft/40">
          <h2 className="font-serif text-xl font-semibold">Comptes de démonstration</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Personas fictives. Mot de passe commun : <code className="rounded bg-surface px-1.5 py-0.5 font-mono">demo</code>. Aucune donnée réelle.
          </p>
          <ul className="mt-4 space-y-2">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="w-full rounded-md border border-line bg-surface p-3 text-left hover:border-brand"
                  onClick={() => {
                    form.setValue("email", a.email, { shouldValidate: true });
                    form.setValue("password", "demo", { shouldValidate: true });
                    void submit();
                  }}
                >
                  <span className="block font-medium">{a.label}</span>
                  <span className="block text-xs text-ink-muted">{a.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
