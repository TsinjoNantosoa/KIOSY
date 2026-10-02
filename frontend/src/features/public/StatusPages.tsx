import { Lock, SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { useDocumentTitle } from "@/lib/hooks";
import { brand } from "@/config/app";

export function NotFoundPage() {
  useDocumentTitle(`Page introuvable · ${brand.name}`);
  return (
    <div className="container max-w-xl py-16 text-center">
      <SearchX className="mx-auto h-10 w-10 text-ink-subtle" aria-hidden />
      <h1 className="mt-4 text-3xl font-semibold">Page introuvable</h1>
      <p className="mt-3 text-ink-muted">Cette adresse ne correspond à aucune page, ou le contenu n'est plus disponible.</p>
      <div className="mt-6 flex justify-center gap-3">
        <ButtonLink to="/">Accueil</ButtonLink>
        <ButtonLink to="/catalogue" variant="outline">
          Catalogue
        </ButtonLink>
      </div>
    </div>
  );
}

export function ForbiddenPage() {
  useDocumentTitle(`Accès refusé · ${brand.name}`);
  return (
    <div className="container max-w-xl py-16 text-center">
      <Lock className="mx-auto h-10 w-10 text-ink-subtle" aria-hidden />
      <h1 className="mt-4 text-3xl font-semibold">Accès refusé</h1>
      <p className="mt-3 text-ink-muted">Votre compte n'a pas les droits nécessaires pour cet espace. Si vous pensez qu'il s'agit d'une erreur, contactez un administrateur.</p>
      <div className="mt-6 flex justify-center gap-3">
        <ButtonLink to="/">Accueil</ButtonLink>
        <ButtonLink to="/compte" variant="outline">
          Mon espace
        </ButtonLink>
      </div>
    </div>
  );
}
