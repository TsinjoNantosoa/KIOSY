import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/locales";

type ToastTone = "success" | "info" | "danger";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<{ notify: (message: string, tone?: ToastTone) => void } | null>(null);

/** Notifications discrètes annoncées aux lecteurs d'écran via une région live polie. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);
  const notify = useCallback(
    (message: string, tone: ToastTone = "success") => {
      counter.current += 1;
      const id = counter.current;
      setItems((list) => [...list.slice(-2), { id, tone, message }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((item) => {
          const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "danger" ? XCircle : Info;
          return (
            <div
              key={item.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border bg-surface p-3 text-sm shadow-lift",
                item.tone === "danger" ? "border-danger/40" : "border-line",
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", item.tone === "danger" ? "text-danger" : "text-brand")} aria-hidden />
              <p className="flex-1">{item.message}</p>
              <button type="button" onClick={() => dismiss(item.id)} className="rounded p-1 text-ink-muted hover:bg-sunken" aria-label={t.common.close}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans ToastProvider");
  return ctx;
}
