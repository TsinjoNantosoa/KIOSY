import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { brand, isDemo } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import { Button } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Checkbox, Field, Input } from "@/components/ui/Form";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";
import { safeReturnPath } from "./guards";
import { useApplySession } from "./session";

const schema = z
  .object({
    display_name: z.string().trim().min(2, "Au moins 2 caractères.").max(60, "60 caractères maximum."),
    email: z.string().trim().email("Adresse e-mail invalide."),
    password: z.string().min(10, "Au moins 10 caractères.").max(128),
    confirm: z.string(),
    adult: z.literal(true, { errorMap: () => ({ message: "Les achats sont réservés aux personnes majeures." }) }),
    terms: z.literal(true, { errorMap: () => ({ message: "L'acceptation des conditions est nécessaire." }) }),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

type Values = z.input<typeof schema>;

export default function RegisterPage() {
  useDocumentTitle(`Créer un compte · ${brand.name}`);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const apply = useApplySession();
  const terms = useQuery({ queryKey: ["contract-document", "utilisation", "current"], queryFn: ({ signal }) => api.legal.current("utilisation", { signal }), retry: false });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { display_name: "", email: "", password: "", confirm: "" } });
  const register = useMutation({
    mutationFn: (v: Values) => {
      if (!terms.data) throw new Error("La version des conditions n'est pas disponible.");
      return api.auth.register({ display_name: v.display_name, email: v.email, password: v.password, accepted_terms_version: terms.data.version });
    },
    onSuccess: (session) => {
      apply(session);
      navigate(safeReturnPath(params.get("retour")), { replace: true });
    },
    onError: (error) => {
      if (isApiError(error)) for (const d of error.details) if (d.field === "email") form.setError("email", { message: d.issue });
    },
  });
  const e = form.formState.errors;

  return (
    <div className="container max-w-lg py-10 md:py-16">
      <h1 className="text-3xl font-semibold">Créer un compte</h1>
      <p className="mt-2 text-ink-muted">
        Déjà inscrit ? <Link to="/connexion" className="text-brand underline">Se connecter</Link>
      </p>
      {isDemo && (
        <Alert tone="warning" className="mt-6">
          Mode démonstration : n'utilisez pas une adresse ni un mot de passe réels. Le compte n'existe que dans ce navigateur.
        </Alert>
      )}
      {terms.isError && <Alert tone="warning" className="mt-6" title="Inscription temporairement indisponible">La version officielle des conditions n'a pas pu être chargée. Réessayez avant de créer le compte.</Alert>}
      <form onSubmit={form.handleSubmit((v) => register.mutate(v))} noValidate className="mt-6 space-y-4">
        <Field label="Nom affiché" error={e.display_name?.message} required>
          <Input autoComplete="nickname" {...form.register("display_name")} />
        </Field>
        <Field label="Adresse e-mail" error={e.email?.message} required>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Mot de passe" hint="10 caractères minimum." error={e.password?.message} required>
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Confirmer le mot de passe" error={e.confirm?.message} required>
          <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <Checkbox label="Je confirme être majeur(e)." error={e.adult?.message} {...form.register("adult")} />
        <Checkbox
          label={
            <>
              J'accepte les <Link to="/conditions/utilisation" className="text-brand underline" target="_blank">conditions d'utilisation</Link> et j'ai lu la{" "}
              <Link to="/confidentialite" className="text-brand underline" target="_blank">politique de confidentialité</Link> {terms.data ? `(version ${terms.data.version}${terms.data.source === "demo" ? ", provisoire" : ""})` : "(version en cours de chargement)"}.
            </>
          }
          error={e.terms?.message}
          {...form.register("terms")}
        />
        {register.error && !(isApiError(register.error) && register.error.details.some((d) => d.field)) && <InlineError error={register.error} />}
        <Button type="submit" className="w-full" loading={register.isPending} disabled={!terms.data || terms.isError}>
          Créer mon compte
        </Button>
      </form>
    </div>
  );
}
