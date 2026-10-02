import type { SupportCase } from "@/contracts/models";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

export function CaseThread({ supportCase, timeZone, viewer }: { supportCase: SupportCase; timeZone: string; viewer: "reader" | "staff" }) {
  return (
    <ol className="space-y-3" aria-label="Échanges">
      {supportCase.messages.map((m) => {
        const mine = (viewer === "reader" && m.author === "reader") || (viewer === "staff" && m.author === "support");
        return (
          <li key={m.id} className={cn("max-w-[90%] rounded-card border p-3 sm:max-w-[75%]", mine ? "ml-auto border-brand/30 bg-brand-soft/50" : "border-line bg-surface")}>
            <p className="text-xs font-medium text-ink-muted">
              {m.author_label} · {formatDateTime(m.at, timeZone)}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
