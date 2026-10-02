import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { configProblem } from "@/config/app";
import { ToastProvider } from "@/components/ui/Toast";
import { createQueryClient } from "@/services/queryClient";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppRoutes } from "./routes";

export function App() {
  const [client] = useState(createQueryClient);
  const problem = configProblem();
  if (problem) return <ConfigError message={problem} />;
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="container max-w-xl py-16">
      <h1 className="text-3xl font-semibold">Configuration incomplète</h1>
      <p className="mt-4 text-ink-muted">{message}</p>
      <p className="mt-2 text-sm text-ink-subtle">Consultez le fichier .env.example et docs/DEPLOYMENT.md.</p>
    </main>
  );
}
