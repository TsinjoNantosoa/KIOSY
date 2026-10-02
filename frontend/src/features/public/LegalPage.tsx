import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { brand } from "@/config/app";
import { TERMS_DOCUMENTS, type TermsDocument } from "@/content/terms";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Layout";
import { useDocumentTitle } from "@/lib/hooks";
import { NotFoundPage } from "./StatusPages";
import { api } from "@/services/api";

export default function LegalPage({ slug: forced }: { slug?: TermsDocument["slug"] }) {
  const params = useParams();
  const slug = forced ?? params.slug;
  const localDefinition = TERMS_DOCUMENTS.find((d) => d.slug === slug);
  const location = useLocation();
  const requestedVersion = new URLSearchParams(location.search).get("version");
  const contractDocument = useQuery({
    queryKey: ["contract-document", slug, requestedVersion ?? "current"],
    queryFn: ({ signal }) => requestedVersion ? api.legal.get(slug!, requestedVersion, { signal }) : api.legal.current(slug!, { signal }),
    enabled: Boolean(localDefinition),
    retry: false,
  });
  useDocumentTitle(`${contractDocument.data?.title ?? localDefinition?.title ?? "Conditions"} · ${brand.name}`);

  // Ancre de citation : défilement vers la section citée par l'assistant.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    el?.scrollIntoView();
    el?.focus({ preventScroll: true });
  }, [location.hash, contractDocument.data]);

  if (!localDefinition) return <NotFoundPage />;
  if (contractDocument.isPending) return <div className="container max-w-3xl py-10"><LoadingBlock lines={8} label="Chargement du document contractuel…" /></div>;
  if (contractDocument.isError) return <div className="container max-w-3xl py-10"><PageHeader title="Document indisponible" /><ErrorState error={contractDocument.error} onRetry={() => contractDocument.refetch()} /></div>;
  const doc = contractDocument.data;
  return (
    <div className="container max-w-3xl py-10">
      <PageHeader title={doc.title} description={`Version ${doc.version}`} />
      {doc.source === "demo" && <Alert tone="warning" title="Document provisoire" className="mb-8">Ce texte est un brouillon de démonstration. Il n'a été validé par aucun professionnel du droit.</Alert>}
      <nav aria-label="Sommaire" className="mb-8">
        <ul className="flex flex-wrap gap-2 text-sm">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="rounded-full border border-line px-3 py-1 hover:border-brand">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-8">
        {doc.sections.map((s, i) => (
          <section key={s.id} id={s.id} tabIndex={-1} className="scroll-mt-24 rounded-md outline-none target:bg-caution-soft/60 target:p-3">
            <h2 className="font-serif text-xl font-semibold">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-2 leading-7 text-ink">{s.body}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm text-ink-muted">
        Autres documents :{" "}
        {TERMS_DOCUMENTS.filter((d) => d.slug !== slug).map((d, i) => (
          <span key={d.slug}>
            {i > 0 && " · "}
            <Link to={d.slug === "confidentialite" ? "/confidentialite" : `/conditions/${d.slug}`} className="text-brand underline">
              {d.title}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
