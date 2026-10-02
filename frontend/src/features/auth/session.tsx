import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { appConfig } from "@/config/app";
import type { Role, Session, User } from "@/contracts/models";
import { api } from "@/services/api";
import { clearPrivateCache } from "@/services/queryClient";
import { qk } from "@/services/queryKeys";

export type SessionStatus = "loading" | "authenticated" | "anonymous" | "unavailable";

export function useSession() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: qk.session, queryFn: ({ signal }) => api.auth.getSession({ signal }), staleTime: 5 * 60_000 });
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("kiosy-session");
    channel.onmessage = (event) => {
      if (event.data?.type === "local-logout") {
        clearPrivateCache(client);
        client.setQueryData(qk.session, null);
      }
    };
    return () => channel.close();
  }, [client]);
  const session = query.data ?? null;
  const status: SessionStatus = query.isPending ? "loading" : query.isError ? "unavailable" : session ? "authenticated" : "anonymous";
  return { session, user: session?.user ?? null, status, error: query.error, refetch: query.refetch };
}

/** Identifiant utilisé dans les clés de cache privées. */
export function useUid(): string {
  const { user } = useSession();
  return user?.id ?? "anon";
}

export function useTimeZone(): string {
  const { user } = useSession();
  return user?.preferences.time_zone ?? appConfig.defaultTimeZone;
}

export function hasAnyRole(user: User | null, roles: Role[]): boolean {
  return Boolean(user && user.roles.some((r) => roles.includes(r)));
}

export const STAFF_ROLES: Role[] = ["support", "manager", "admin"];

/** Remplace la session en purgeant d'abord les données du compte précédent. */
export function useApplySession() {
  const client = useQueryClient();
  return useCallback(
    (session: Session | null) => {
      clearPrivateCache(client);
      client.setQueryData(qk.session, session);
    },
    [client],
  );
}

export function useLogin() {
  const apply = useApplySession();
  return useMutation({ mutationFn: api.auth.login, onSuccess: apply });
}

export function useLogout() {
  const apply = useApplySession();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    // La purge locale est immédiate et distincte de la révocation du cookie HttpOnly par le serveur.
    onMutate: () => {
      apply(null);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("kiosy-session");
        channel.postMessage({ type: "local-logout" });
        channel.close();
      }
    },
  });
}
