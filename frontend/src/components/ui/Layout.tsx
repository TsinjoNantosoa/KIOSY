import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { buttonClass } from "./Button";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {back.label}
          </Link>
        )}
        {eyebrow && <p className="mb-1 text-sm font-medium uppercase tracking-wider text-warm">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

export function Card({ children, className, as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={cn("card-surface p-5 md:p-6", className)}>{children}</Tag>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("mb-4 font-serif text-xl font-semibold", className)}>{children}</h2>;
}

export function DefinitionList({ items, className }: { items: { term: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((item, i) => (
        <div key={i} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm text-ink-muted">{item.term}</dt>
          <dd className="text-sm font-medium sm:col-span-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, pageSize, total, hrefFor, label = "Pagination" }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className="mt-8 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link to={hrefFor(page - 1)} className={buttonClass("outline", "md")} rel="prev">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Précédent
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-ink-muted" aria-current="page">
        Page {page} sur {pages}
      </p>
      {page < pages ? (
        <Link to={hrefFor(page + 1)} className={buttonClass("outline", "md")} rel="next">
          Suivant <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
