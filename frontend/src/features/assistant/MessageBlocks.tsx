import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, FileText, LifeBuoy, LogIn, Quote } from "lucide-react";
import type { Citation, Message, MessageBlock, OfferComparisonRow } from "@/contracts/models";
import { Cover } from "@/components/Cover";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { classifyLink } from "@/lib/safeUrl";
import { t } from "@/locales";
import { useTimeZone } from "@/features/auth/session";
import { ProposalCard } from "@/features/proposals/ProposalCard";

/** Nature d'une réponse (UX03) : information, action préparée, échec. */
export function messageKind(message: Message): "information" | "prepared" | "failed" {
  if (message.blocks.some((b) => b.type === "error")) return "failed";
  if (message.blocks.some((b) => b.type === "proposal")) return "prepared";
  return "information";
}

export function MessageBlocks({ message, onQuickReply }: { message: Message; onQuickReply: (text: string) => void }) {
  return (
    <div className="space-y-3">
      {message.blocks.map((block, i) => (
        <Block key={i} block={block} onQuickReply={onQuickReply} />
      ))}
    </div>
  );
}

function Block({ block, onQuickReply }: { block: MessageBlock; onQuickReply: (text: string) => void }) {
  const location = useLocation();
  switch (block.type) {
    case "text":
      return <SafeMarkdown source={block.markdown} className="kiosy-compact" headingOffset={1} />;
    case "publications":
      return (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {block.items.map((item) => (
            <li key={item.publication_id}>
              <Link to={`/publications/${item.slug}`} className="flex gap-3 rounded-md border border-line bg-surface p-2 hover:border-brand">
                <span className="w-12 shrink-0">
                  <Cover spec={item.cover} title={item.title} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="block text-xs text-ink-muted">{item.subtitle} · {t.universe[item.universe]}</span>
                  <span className="mt-1 block text-xs text-brand-strong">{item.reason}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case "offer_comparison":
      return <OfferComparison rows={block.rows} />;
    case "citations":
      return <Citations items={block.items} />;
    case "clarification":
      return (
        <div className="rounded-md border border-line bg-surface p-3">
          <p className="text-sm font-medium">{block.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {block.options.map((option) => (
              <button key={option} type="button" onClick={() => onQuickReply(option)} className="min-h-9 rounded-full border border-brand/40 bg-brand-soft px-3 text-sm font-medium text-brand-strong hover:border-brand">
                {option}
              </button>
            ))}
          </div>
        </div>
      );
    case "proposal":
      return <ProposalCard proposalId={block.proposal_id} />;
    case "notice":
      return <Alert tone={block.tone === "warning" ? "warning" : "info"}>{block.text}</Alert>;
    case "error":
      return (
        <Alert tone="danger" title={t.assistant.kinds.failed} role="alert">
          <p>{block.text}</p>
          <p className="mt-1 text-xs text-ink-muted">Code : {block.code}{block.retryable ? " · vous pouvez réessayer plus tard" : ""}</p>
        </Alert>
      );
    case "handoff":
      return (
        <div className="rounded-md border border-line bg-surface p-3 text-sm">
          <p className="flex items-start gap-2"><LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />{block.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {block.case_id ? (
              <ButtonLink to={`/compte/assistance/${block.case_id}`} size="sm" variant="outline">Suivre la demande</ButtonLink>
            ) : (
              <ButtonLink to="/compte/assistance/nouvelle" size="sm" variant="outline">Ouvrir une demande d'assistance</ButtonLink>
            )}
            <ButtonLink to="/compte/bibliotheque" size="sm" variant="ghost">Ma bibliothèque</ButtonLink>
          </div>
        </div>
      );
    case "auth_required":
      return (
        <div className="rounded-md border border-info/30 bg-info-soft p-3 text-sm">
          <p>{block.text}</p>
          <ButtonLink to={`/connexion?retour=${encodeURIComponent(location.pathname + location.search)}`} size="sm" className="mt-2" icon={<LogIn className="h-4 w-4" aria-hidden />}>
            Se connecter
          </ButtonLink>
        </div>
      );
  }
}

const rowTone: Record<OfferComparisonRow["status"], { label: string; tone: "brand" | "neutral" | "danger" | "success" } | null> = {
  recommended: { label: "Adaptée à votre demande", tone: "brand" },
  redundant: { label: "Déjà couverte", tone: "success" },
  unavailable: { label: "Indisponible", tone: "danger" },
  neutral: null,
};

function OfferComparison({ rows }: { rows: OfferComparisonRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <p className="border-b border-line bg-sunken/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Comparaison des offres (prix serveur)</p>
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const tone = rowTone[row.status];
          return (
            <li key={row.offer_id} className="p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-medium">{row.title}</span>
                <span className="font-semibold">{formatMoney(row.price)}</span>
              </div>
              <p className="text-xs text-ink-muted">
                {row.includes} · {formatDuration(row.duration)} · {row.renewal === "manual" ? "renouvellement manuel" : "sans renouvellement"}
              </p>
              {(tone || row.note) && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {tone && <Badge tone={tone.tone}>{tone.label}</Badge>}
                  {row.note && <span className="text-ink-muted">{row.note}</span>}
                </p>
              )}
              {row.status === "recommended" && (
                <Link to={`/commande?offre=${row.offer_id}`} className="mt-1 inline-block text-xs font-medium text-brand underline">
                  Commander via le formulaire classique
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Citations({ items }: { items: Citation[] }) {
  const tz = useTimeZone();
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Quote className="h-3.5 w-3.5" aria-hidden /> Sources
      </p>
      <ol className="space-y-3">
        {items.map((c, i) => {
          const link = c.href ? classifyLink(c.href) : null;
          // Les conversations créées avant l'ajout de cette métadonnée doivent rester ouvrables.
          const effectiveDate = typeof c.effective_date === "string" && !Number.isNaN(Date.parse(c.effective_date))
            ? formatDate(c.effective_date, tz)
            : null;
          return (
            <li key={c.id} className="text-sm">
              <p className="font-medium">
                [{i + 1}] {c.document_title} — {c.section}
              </p>
              <p className="text-xs text-ink-subtle">Version {c.version}{effectiveDate ? ` · en vigueur depuis le ${effectiveDate}` : ""}</p>
              <blockquote className="mt-1 border-l-2 border-line pl-3 text-ink-muted">« {c.quote} »</blockquote>
              {link?.kind === "internal" ? (
                <Link to={link.to} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand underline">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> Ouvrir le passage
                </Link>
              ) : (
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-subtle">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Passage non consultable avec vos droits actuels.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
