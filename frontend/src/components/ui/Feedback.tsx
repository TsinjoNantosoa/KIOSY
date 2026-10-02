import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, SearchX, WifiOff, XCircle } from "lucide-react";
import { isApiError, type ErrorKind } from "@/contracts/errors";
import { cn } from "@/lib/cn";
import { t } from "@/locales";
import { Button, ButtonLink } from "./Button";

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const toneStyles: Record<Tone, string> = {
  info: "border-info/30 bg-info-soft text-info",
  success: "border-brand/30 bg-brand-soft text-brand-strong",
  warning: "border-caution/30 bg-caution-soft text-caution",
  danger: "border-danger/30 bg-danger-soft text-danger",
  neutral: "border-line bg-sunken text-ink",
};
const toneIcons: Record<Tone, typeof Info> = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, neutral: Info };

export function Alert({ tone = "info", title, children, className, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const Icon = toneIcons[tone];
  return (
    <div className={cn("flex gap-3 rounded-card border p-4", toneStyles[tone], className)} role={role}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 text-sm leading-6">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink">{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = t.common.loading, className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-2 text-sm text-ink-muted", className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-sunken", className)} />;
}

export function LoadingBlock({ label = t.common.loading, lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <div className="mb-3 text-ink-subtle" aria-hidden>
        {icon ?? <SearchX className="h-8 w-8" />}
      </div>
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm leading-6 text-ink-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const kindIcon: Partial<Record<ErrorKind, typeof Info>> = { network: WifiOff, forbidden: Lock, unauthenticated: Lock, not_found: SearchX };

/** État d'erreur distinguant 401/403/404/409/422/429/503 et réseau, avec relance si pertinente. */
export function ErrorState({ error, onRetry, title, className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const kind: ErrorKind = isApiError(error) ? error.kind : "unknown";
  const copy = t.errors[kind];
  const Icon = kindIcon[kind] ?? AlertTriangle;
  const retryable = ["network", "unavailable", "rate_limited", "unknown", "conflict"].includes(kind);
  const detail = isApiError(error) && kind !== "unknown" && kind !== "network" ? error.message : null;
  return (
    <div role="alert" className={cn("rounded-card border border-line bg-surface px-6 py-10 text-center", className)}>
      <Icon className="mx-auto mb-3 h-8 w-8 text-ink-subtle" aria-hidden />
      <h2 className="font-serif text-xl font-semibold">{title ?? copy.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">{detail ?? copy.body}</p>
      {isApiError(error) && error.requestId && <p className="mt-2 text-xs text-ink-subtle">Référence : {error.requestId}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {retryable && onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {t.common.retry}
          </Button>
        )}
        {kind === "unauthenticated" && <ButtonLink to="/connexion">{t.nav.login}</ButtonLink>}
        {(kind === "not_found" || kind === "forbidden") && (
          <ButtonLink to="/catalogue" variant="outline">
            Explorer le catalogue
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const kind: ErrorKind = isApiError(error) ? error.kind : "unknown";
  const message = isApiError(error) && kind !== "network" && kind !== "unknown" ? error.message : t.errors[kind].body;
  return (
    <Alert tone="danger" title={t.errors[kind].title} role="alert">
      {message}
    </Alert>
  );
}
