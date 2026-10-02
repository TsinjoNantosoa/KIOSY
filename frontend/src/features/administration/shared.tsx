import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";

/** Requêtes d'administration, isolées sous ["admin", uid, ...] et purgées à la déconnexion. */
export function useAdminQuery<T>(key: unknown[], fn: (ctx: QueryFunctionContext) => Promise<T>, options: { refetchInterval?: number | false | ((data: T | undefined) => number | false); enabled?: boolean } = {}) {
  const uid = useUid();
  const { refetchInterval, enabled } = options;
  return useQuery({
    queryKey: qk.admin(uid, ...key),
    queryFn: fn,
    enabled,
    refetchInterval: typeof refetchInterval === "function" ? (q) => refetchInterval(q.state.data as T | undefined) : refetchInterval,
  });
}

export function useAdminKey() {
  const uid = useUid();
  return (...key: unknown[]) => qk.admin(uid, ...key);
}

/** Tableau responsive : tableau sur desktop, cartes empilées sur mobile. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  empty = "Aucun élément.",
}: {
  rows: T[];
  columns: { header: string; cell: (row: T) => ReactNode; className?: string; primary?: boolean }[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <>
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="card-surface space-y-1.5 p-4 text-sm">
            {columns.map((c) => (
              <div key={c.header} className={cn("flex justify-between gap-3", c.primary && "font-medium")}>
                {!c.primary && <span className="text-ink-muted">{c.header}</span>}
                <span className={cn("min-w-0", !c.primary && "text-right")}>{c.cell(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-sunken/60">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cn("whitespace-nowrap p-3 font-semibold", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-line align-top">
                {columns.map((c) => (
                  <td key={c.header} className={cn("p-3", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StatCard({ label, value, hint, tone = "neutral", to }: { label: string; value: ReactNode; hint?: string; tone?: "neutral" | "warning" | "danger"; to?: string }) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={cn("mt-1 font-serif text-3xl font-semibold", tone === "warning" && "text-caution", tone === "danger" && "text-danger")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card-surface block p-4 hover:border-brand">
      {body}
    </Link>
  ) : (
    <div className="card-surface p-4">{body}</div>
  );
}
