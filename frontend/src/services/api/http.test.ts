import { appConfig } from "@/config/app";
import { ApiError } from "@/contracts/errors";
import { createHttpApi } from "./http";

describe("adaptateur HTTP", () => {
  const originalBase = appConfig.apiBaseUrl;
  beforeEach(() => { (appConfig as unknown as { apiBaseUrl: string }).apiBaseUrl = "https://api.example.test"; });
  afterEach(() => { (appConfig as unknown as { apiBaseUrl: string }).apiBaseUrl = originalBase; vi.unstubAllGlobals(); });

  it.each([
    [401, "unauthenticated"], [403, "forbidden"], [409, "conflict"], [422, "validation"], [429, "rate_limited"], [503, "unavailable"],
  ] as const)("normalise une réponse %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: `E${status}`, message: "Refus contrôlé" }), { status, headers: { "Content-Type": "application/json" } })));
    const error = await createHttpApi().offers.get("off").catch((value) => value) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe(kind);
  });

  it("refuse une réponse critique invalide sans faux succès", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "off", title: "incomplet" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const error = await createHttpApi().offers.get("off").catch((value) => value) as ApiError;
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("normalise une erreur réseau", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(createHttpApi().offers.get("off")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("préserve l'annulation AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(createHttpApi().offers.get("off")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejette un événement de run mal formé", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ type: "status", seq: "bad" }]), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(createHttpApi().assistant.listRunEvents("run", 0)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
