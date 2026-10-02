import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role } from "@/contracts/models";
import { Alert, LoadingBlock } from "@/components/ui/Feedback";
import { hasAnyRole, useSession } from "./session";
import { ForbiddenPage } from "@/features/public/StatusPages";

/**
 * Protections de routes : confort d'interface uniquement. Chaque appel reste contrôlé
 * par le serveur (IAM01) ; masquer une route n'accorde ni ne retire aucun droit.
 */
/**
 * Déconnexion volontaire en cours : tant que la navigation vers l'accueil n'est pas validée,
 * la garde ne redirige pas vers /connexion (sinon elle l'emporterait sur la redirection voulue).
 */
let leaving = false;
export function beginLogout() {
  leaving = true;
}
export function endLogout() {
  leaving = false;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="container py-12">
        <LoadingBlock label="Vérification de votre session…" />
      </div>
    );
  }
  if (status === "unavailable") {
    return <div className="container py-12"><Alert tone="warning" title="Service d'authentification indisponible">Impossible de vérifier votre session. Une erreur réseau ne signifie pas que vous êtes déconnecté. Réessayez dans quelques instants.</Alert></div>;
  }
  if (status === "anonymous") {
    if (leaving) return null;
    const retour = `${location.pathname}${location.search}`;
    return <Navigate to={`/connexion?retour=${encodeURIComponent(retour)}`} replace />;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useSession();
  return (
    <RequireAuth>
      {hasAnyRole(user, roles) ? children : <ForbiddenPage />}
    </RequireAuth>
  );
}

/** N'autorise que des chemins internes comme destination de retour (pas de redirection ouverte). */
export function safeReturnPath(raw: string | null, fallback = "/compte"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}
