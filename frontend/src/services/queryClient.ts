import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/contracts/errors";
import { PRIVATE_ROOTS, qk } from "./queryKeys";

export const SESSION_EXPIRED_EVENT = "kiosy:session-expired";

/** Purge toutes les données personnelles du cache (déconnexion, changement de compte, 401). */
export function clearPrivateCache(client: QueryClient): void {
  for (const root of PRIVATE_ROOTS) {
    client.cancelQueries({ queryKey: [root] });
    client.removeQueries({ queryKey: [root] });
  }
}

function handleUnauthenticated(client: QueryClient, error: unknown, isSessionQuery: boolean) {
  if (!isApiError(error) || error.status !== 401 || isSessionQuery) return;
  const hadSession = Boolean(client.getQueryData(qk.session));
  clearPrivateCache(client);
  client.setQueryData(qk.session, null);
  if (hadSession && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { code: error.code } }));
  }
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleUnauthenticated(client, error, query.queryKey[0] === "session"),
    }),
    mutationCache: new MutationCache({
      onError: (error) => handleUnauthenticated(client, error, false),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Relance limitée aux erreurs transitoires ; jamais sur 4xx.
        retry: (count, error) => isApiError(error) && (error.kind === "network" || error.kind === "unavailable") && count < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000) + Math.random() * 300,
      },
      // Aucune relance automatique d'une écriture (OPS02) : l'utilisateur relance avec la même clé.
      mutations: { retry: false },
    },
  });
  return client;
}
