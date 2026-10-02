import { lazy, Suspense } from "react";

const DemoBar = import.meta.env.VITE_APP_MODE === "api"
  ? null
  : lazy(async () => {
      const module = await import("./DemoTools");
      return { default: module.DemoBar };
    });

export function DemoBarSlot({ compact = false }: { compact?: boolean }) {
  if (!DemoBar) return null;
  return <Suspense fallback={null}><DemoBar compact={compact} /></Suspense>;
}
