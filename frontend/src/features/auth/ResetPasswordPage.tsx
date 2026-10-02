import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { brand } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Form";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";

const schema = z
  .object({ password: z.string().min(10, "Au moins 10 caractères.").max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

export default function ResetPasswordPage() {
  useDocumentTitle(`Nouveau mot de passe · ${brand.name}`);
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const reset = useMutation({ mutationFn: (password: string) => api.auth.resetPassword({ token, password }) });
  const invalidToken = !token || (isApiError(reset.error) && reset.error.code === "INVALID_TOKEN");

  return (
    <div className="container max-w-lg py-10 md:py-16">
      <h1 className="text-3xl font-semibold">Choisir un nouveau mot de passe</h1>
      {reset.isSuccess ? (
        <Alert tone="success" title="Mot de passe modifié" className="mt-6" role="status">
          Vos autres sessions ont été fermées. Vous pouvez vous connecter avec le nouveau mot de passe.
          <div className="mt-3">
            <ButtonLink to="/connexion" size="sm">Se connecter</ButtonLink>
          </div>
        </Alert>
      ) : invalidToken ? (
        <Alert tone="danger" title="Lien invalide ou expiré" className="mt-6" role="alert">
          Ce lien ne peut plus être utilisé. <Link to="/mot-de-passe-oublie" className="font-medium underline">Demander un nouveau lien</Link>.
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit((v) => reset.mutate(v.password))} noValidate className="mt-6 space-y-4">
          <Field label="Nouveau mot de passe" hint="10 caractères minimum." error={form.formState.errors.password?.message} required>
            <Input type="password" autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label="Confirmer" error={form.formState.errors.confirm?.message} required>
            <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
          </Field>
          {reset.error && <InlineError error={reset.error} />}
          <Button type="submit" className="w-full" loading={reset.isPending}>
            Enregistrer
          </Button>
        </form>
      )}
    </div>
  );
}
