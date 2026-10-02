import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { classifyLink } from "@/lib/safeUrl";

/**
 * Rendu Markdown restreint et SANS HTML (SEC04) : titres, paragraphes, listes, gras, italique
 * et liens. Le texte est toujours rendu comme texte React (échappé) ; aucun
 * dangerouslySetInnerHTML. Les liens non sûrs sont affichés comme texte simple.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== "");
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label = "", target = ""] = link;
      const safe = classifyLink(target);
      if (safe.kind === "internal") {
        return (
          <Link key={key} to={safe.to} className="font-medium text-brand underline underline-offset-2 hover:text-brand-strong">
            {label}
          </Link>
        );
      }
      if (safe.kind === "external") {
        return (
          <a key={key} href={safe.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand underline underline-offset-2">
            {label}
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        );
      }
      return <Fragment key={key}>{label}</Fragment>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function withBreaks(text: string, keyPrefix: string): ReactNode[] {
  return text.split("\n").flatMap((line, i, arr) => {
    const nodes = renderInline(line, `${keyPrefix}-${i}`);
    return i < arr.length - 1 ? [...nodes, <br key={`${keyPrefix}-br-${i}`} />] : nodes;
  });
}

export function SafeMarkdown({ source, className, headingOffset = 0 }: { source: string; className?: string; headingOffset?: 0 | 1 }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={cn("kiosy-prose", className)}>
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const key = `b${index}`;
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading && !trimmed.includes("\n")) {
          const level = Math.min(heading[1]!.length + 1 + headingOffset, 4);
          const Tag = `h${level}` as "h2" | "h3" | "h4";
          return <Tag key={key}>{renderInline(heading[2]!, key)}</Tag>;
        }
        const lines = trimmed.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={key}>
              {lines.map((l, i) => (
                <li key={`${key}-${i}`}>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return (
            <ol key={key}>
              {lines.map((l, i) => (
                <li key={`${key}-${i}`}>{renderInline(l.replace(/^\s*\d+\.\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }
        return <p key={key}>{withBreaks(trimmed, key)}</p>;
      })}
    </div>
  );
}
