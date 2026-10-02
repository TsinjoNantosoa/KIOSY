import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "brand" | "warm" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-muted border-line",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
  warm: "bg-warm-soft text-warm border-warm/20",
  success: "bg-brand-soft text-brand-strong border-brand/20",
  warning: "bg-caution-soft text-caution border-caution/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info-soft text-info border-info/20",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

/** Marque explicite des contenus, offres et paiements de démonstration (section 3). */
export function DemoBadge({ label = "Démo" }: { label?: string }) {
  return (
    <Badge tone="warm" className="uppercase tracking-wide">
      {label}
    </Badge>
  );
}
