import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Minus, Plus } from "lucide-react";
import { appConfig, brand } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import type { AssetAccess } from "@/contracts/models";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { useDocumentTitle, useMediaQuery } from "@/lib/hooks";
import { safeAssetUrl } from "@/lib/safeUrl";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";
import { Lock, TimerOff } from "lucide-react";

const pendingRevocations = new Map<string, ReturnType<typeof setTimeout>>();

interface LoadedAsset {
  access: AssetAccess;
  markdown: string | null;
}

/** Les URL blob créées localement (mode démo) sont révoquées dès qu'elles ne servent plus. */
function revoke(url: string) {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

async function loadAsset(editionId: string, signal: AbortSignal): Promise<LoadedAsset> {
  const access = await api.me.assetAccess(editionId, { signal });
  const safeUrl = safeAssetUrl(access.url, appConfig.assetAllowedOrigins);
  if (!safeUrl) throw new Error("L'origine du fichier n'est pas autorisée par la configuration.");
  if (Date.parse(access.expires_at) <= Date.now()) throw new Error("Le lien de lecture a expiré. Demandez une nouvelle autorisation.");
  access.url = safeUrl;
  if (access.media_type !== "text/markdown") return { access, markdown: null };
  const response = await fetch(access.url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("Contenu indisponible");
  const markdown = await response.text();
  revoke(access.url);
  return { access, markdown };
}

export default function ReaderPage() {
  const { editionId = "" } = useParams();
  const uid = useUid();
  const location = useLocation();
  const desktop = useMediaQuery("(min-width: 768px)");
  const [fontScale, setFontScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  // Contrôle d'accès à chaque ouverture ; l'URL signée n'est ni mise en cache durablement ni stockée.
  const asset = useQuery({
    queryKey: qk.asset(uid, editionId),
    queryFn: ({ signal }) => loadAsset(editionId, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  useDocumentTitle(asset.data ? `${asset.data.access.title} · ${brand.name}` : `Lecture · ${brand.name}`);

  const pdfUrl = asset.data?.access.media_type === "application/pdf" ? asset.data.access.url : null;
  useEffect(() => {
    if (!pdfUrl) return;
    const pending = pendingRevocations.get(pdfUrl);
    if (pending) clearTimeout(pending);
    return () => {
      // Révocation différée : tolère le double montage de StrictMode en développement.
      pendingRevocations.set(pdfUrl, setTimeout(() => {
        revoke(pdfUrl);
        pendingRevocations.delete(pdfUrl);
      }, 1000));
    };
  }, [pdfUrl]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      // Nouvelle autorisation au moment du téléchargement : l'URL précédente a pu expirer.
      const fresh = await api.me.assetAccess(editionId);
      if (!fresh.download_allowed) throw new Error("Le téléchargement n'est plus autorisé pour cet accès.");
      if (Date.parse(fresh.expires_at) <= Date.now()) throw new Error("Le lien reçu a déjà expiré. Réessayez pour demander une nouvelle autorisation.");
      const url = safeAssetUrl(fresh.url, appConfig.assetAllowedOrigins);
      if (!url) throw new Error("L'origine du fichier n'est pas autorisée.");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${fresh.title} - ${fresh.edition_label}.pdf`;
      anchor.rel = "noopener";
      anchor.target = "_blank";
      anchor.click();
      window.setTimeout(() => revoke(url), 30_000);
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  };

  const header = (
    <div className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="container flex min-h-14 items-center gap-2">
        <Link to="/compte/bibliotheque" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-sunken">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Bibliothèque</span>
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {asset.data ? `${asset.data.access.title} — ${asset.data.access.edition_label}` : "Lecture"}
        </p>
        {asset.data?.markdown !== null && asset.data && (
          <div className="flex items-center gap-1" role="group" aria-label="Taille du texte">
            <Button variant="ghost" size="sm" aria-label="Réduire le texte" onClick={() => setFontScale((s) => Math.max(0.85, s - 0.1))} disabled={fontScale <= 0.85}>
              <Minus className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Agrandir le texte" onClick={() => setFontScale((s) => Math.min(1.5, s + 0.1))} disabled={fontScale >= 1.5}>
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
        {asset.data?.access.download_allowed && (
          <Button variant="outline" size="sm" loading={downloading} disabled={downloading} onClick={download} icon={<Download className="h-4 w-4" aria-hidden />}>
            <span className="hidden sm:inline">Télécharger</span>
            <span className="sr-only sm:hidden">Télécharger</span>
          </Button>
        )}
      </div>
    </div>
  );

  if (asset.isPending) {
    return (
      <>
        {header}
        <div className="container max-w-prose py-10"><LoadingBlock lines={10} label="Vérification de votre accès…" /></div>
      </>
    );
  }
  if (asset.isError) {
    const code = isApiError(asset.error) ? asset.error.code : null;
    return (
      <>
        {header}
        <div className="container max-w-2xl py-10">
          {code === "ACCESS_EXPIRED" ? (
            <EmptyState title="Votre accès a expiré" icon={<TimerOff className="h-8 w-8" />} action={<div className="flex flex-wrap justify-center gap-3"><ButtonLink to="/compte/abonnements">Mes abonnements</ButtonLink><ButtonLink to="/offres" variant="outline">Voir les offres</ButtonLink></div>}>
              La période de votre droit de lecture est terminée. Renouvelez votre abonnement ou choisissez une offre pour lire à nouveau ce contenu.
            </EmptyState>
          ) : code === "ACCESS_DENIED" ? (
            <EmptyState title="Contenu non inclus dans vos accès" icon={<Lock className="h-8 w-8" />} action={<ButtonLink to="/catalogue">Voir le catalogue</ButtonLink>}>
              Ce contenu nécessite un achat ou un abonnement. L'extrait public reste consultable depuis la fiche de la publication.
            </EmptyState>
          ) : isApiError(asset.error) && asset.error.kind === "unauthenticated" ? (
            <EmptyState title="Connexion requise" icon={<Lock className="h-8 w-8" />} action={<ButtonLink to={`/connexion?retour=${encodeURIComponent(location.pathname)}`}>Se connecter</ButtonLink>}>
              Connectez-vous pour lire ce contenu.
            </EmptyState>
          ) : (
            <ErrorState error={asset.error} onRetry={() => asset.refetch()} />
          )}
        </div>
      </>
    );
  }

  const { access, markdown } = asset.data;
  const downloadMessage = downloadError instanceof Error
    ? downloadError.message
    : "Le téléchargement a échoué. Réessayez dans quelques instants.";
  return (
    <>
      {header}
      {downloadError && <div className="container py-3"><Alert tone="danger" title="Téléchargement impossible">{downloadMessage}</Alert></div>}
      {markdown !== null ? (
        <article className="container max-w-prose py-8 md:py-12" style={{ fontSize: `${fontScale}rem` }}>
          <SafeMarkdown source={markdown} className="[&_h2]:text-[1.6em] [&_p]:text-[1.1em]" />
          <p className="mt-10 border-t border-line pt-4 text-sm text-ink-subtle">
            Fin de l'édition. <Link to={`/publications/${access.publication_slug}`} className="underline">Voir la fiche de la publication</Link>
          </p>
        </article>
      ) : desktop ? (
        <div className="flex flex-1 flex-col">
          <iframe title={`${access.title}, ${access.edition_label} (PDF)`} src={access.url} className="min-h-[80dvh] w-full flex-1 border-0 bg-sunken" />
        </div>
      ) : (
        <div className="container max-w-md py-10 text-center">
          <h1 className="font-serif text-2xl font-semibold">{access.title}</h1>
          <p className="mt-1 text-ink-muted">{access.edition_label} · PDF</p>
          <p className="mt-4 text-sm text-ink-muted">Sur mobile, le PDF s'ouvre dans le lecteur de votre appareil. Le lien est valable quelques minutes.</p>
          <a href={access.url} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-brand px-6 font-medium text-white">
            <ExternalLink className="h-4 w-4" aria-hidden /> Ouvrir le PDF
          </a>
        </div>
      )}
    </>
  );
}
