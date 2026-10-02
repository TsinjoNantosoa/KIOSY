import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/services/api";
import { createQueryClient } from "@/services/queryClient";
import { qk } from "@/services/queryKeys";
import { useLogout, useSession } from "./session";

describe("déconnexion", () => {
  it("purge les données privées du cache", async () => {
    const session = await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const client = createQueryClient();
    client.setQueryData(qk.session, session);
    client.setQueryData(qk.library("u_hery"), [{ secret: true }]);
    client.setQueryData(qk.admin("u_hery", "ops"), { counts: 1 });
    client.setQueryData(qk.featured, []);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => ({ logout: useLogout(), session: useSession() }), { wrapper });
    await act(async () => {
      await result.current.logout.mutateAsync();
    });
    await waitFor(() => expect(result.current.session.status).toBe("anonymous"));
    expect(client.getQueryData(qk.library("u_hery"))).toBeUndefined();
    expect(client.getQueryData(qk.admin("u_hery", "ops"))).toBeUndefined();
    expect(client.getQueryData(qk.featured)).toEqual([]); // données publiques conservées
  });

  it("purge localement même si la révocation serveur échoue et expose l'échec", async () => {
    const session = await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const logoutSpy = vi.spyOn(api.auth, "logout").mockRejectedValueOnce(new Error("service indisponible"));
    const client = createQueryClient();
    client.setQueryData(qk.session, session);
    client.setQueryData(qk.library("u_hery"), [{ secret: true }]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(async () => { await result.current.mutateAsync().catch(() => undefined); });
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(qk.library("u_hery"))).toBeUndefined();
    expect(client.getQueryData(qk.session)).toBeNull();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
