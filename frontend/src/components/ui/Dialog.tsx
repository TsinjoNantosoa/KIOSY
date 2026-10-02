import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/locales";

/** Dialogue accessible (piège du focus, Échap, retour du focus) basé sur Radix. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <RadixDialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-lift sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:p-6",
            size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <RadixDialog.Title className="font-serif text-xl font-semibold">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-ink-muted">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{typeof title === "string" ? title : ""}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close className="-m-2 rounded-md p-2 text-ink-muted hover:bg-sunken" aria-label={t.common.close}>
              <X className="h-5 w-5" aria-hidden />
            </RadixDialog.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Panneau latéral (desktop) / plein écran (mobile). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = "right",
  width = "sm:max-w-md",
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  side?: "left" | "right";
  /** Classe Tailwind littérale, ex. "sm:max-w-md" (plein écran mobile) ou "max-w-xs". */
  width?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <RadixDialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-paper shadow-lift",
            side === "right" ? "right-0" : "left-0",
            width,
          )}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
            <RadixDialog.Title className="min-w-0 truncate font-serif text-lg font-semibold">{title}</RadixDialog.Title>
            <div className="flex items-center gap-1">
              {headerExtra}
              <RadixDialog.Close className="rounded-md p-2 text-ink-muted hover:bg-sunken" aria-label={t.common.close}>
                <X className="h-5 w-5" aria-hidden />
              </RadixDialog.Close>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
