import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { brand, isDemo } from "@/config/app";
import { Button } from "@/components/ui/Button";
import { Alert, InlineError } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Form";
import { useDocumentTitle } from "@/lib/hooks";
import { api } from "@/services/api";

const schema = z.object({ email: z.string().trim().email("Adresse e-mail invalide.") });

export default function ForgotPasswordPage() {
  useDocumentTitle(`Mot de passe oublié · ${brand.name}`);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const request = useMutation({ mutationFn: api.auth.requestPasswordReset });
  return (
    <div className="container max-w-lg py-10 md:py-16">
      <h1 className="text-3xl font-semibold">Mot de passe oublié</h1>
      <p className="mt-2 text-ink-muted">Indiquez votre adresse : si un compte existe, vous recevrez un lien de réinitialisation à usage unique.</p>
      {request.isSuccess ? (
        <Alert tone="success" title="Demande enregistrée" className="mt-6" role="status">
          Si un compte correspond à cette adresse, un e-mail vient d'être envoyé. Le lien expire rapidement.
          {isDemo && (
            <p className="mt-2">
              Mode démo : aucun e-mail n'est envoyé. <Link to="/reinitialiser?token=demo-reset-token" className="font-medium underline">Ouvrir le lien de démonstration</Link>.
            </p>
          )}
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit((v) => request.mutate(v))} noValidate className="mt-6 space-y-4">
          <Field label="Adresse e-mail" error={form.formState.errors.email?.message} required>
            <Input type="email" autoComplete="email" {...form.register("email")} />
          </Field>
          {request.error && <InlineError error={request.error} />}
          <Button type="submit" className="w-full" loading={request.isPending}>
            Recevoir un lien
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link to="/connexion" className="text-brand underline">Retour à la connexion</Link>
      </p>
    </div>
  );
}
