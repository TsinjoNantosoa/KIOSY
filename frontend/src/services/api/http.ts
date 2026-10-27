import { appConfig } from "@/config/app";
import { ApiError, type ApiErrorBody } from "@/contracts/errors";
import type { RunEvent } from "@/contracts/models";
import { assetAccessSchema, offerSchema, orderSchema, proposalSchema, quoteSchema, runEventSchema, runEventsSchema, sessionSchema } from "@/contracts/schemas";
import { followEvents } from "@/services/runFollower";
import type { ZodType } from "zod";
import type { KiosyApi } from "./types";

/**
 * Adaptateur HTTP vers l'API FastAPI (mode api).
 *
 * Session : cookies HttpOnly/Secure posés par le backend, envoyés via `credentials: "include"`.
 * Aucun token n'est lu ni stocké par le frontend. Pour les méthodes non sûres, le jeton CSRF
 * est lu dans le cookie non HttpOnly `kiosy_csrf` (double-submit) et renvoyé dans `X-CSRF-Token`.
 * Ce contrat de session est une PROPOSITION documentée dans docs/API_CONTRACTS.md.
 *
 * En cas d'erreur, aucune donnée de démonstration n'est substituée.
 */

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestInit2 {
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

let csrfToken: string | null = null;

async function ensureCsrfToken(signal?: AbortSignal): Promise<string> {
  if (csrfToken) return csrfToken;
  let response: Response;
  try {
    response = await fetch(buildUrl("/v1/auth/csrf"), { credentials: "include", headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw ApiError.network();
  }
  if (!response.ok) throw await parseError(response);
  const parsed = await response.json().catch(() => null) as { token?: unknown } | null;
  if (!parsed || typeof parsed.token !== "string" || !parsed.token) throw new ApiError(502, { code: "INVALID_RESPONSE", message: "Le service d'authentification a renvoyé une réponse invalide." });
  csrfToken = parsed.token;
  return csrfToken;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${appConfig.apiBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = { code: "UNKNOWN_ERROR", message: "Une erreur est survenue." };
  try {
    const json: unknown = await response.json();
    if (json && typeof json === "object" && "code" in json && "message" in json) body = json as ApiErrorBody;
  } catch {
    // Corps non JSON : message générique, sans exposer le contenu brut.
  }
  const requestId = response.headers.get("X-Request-ID");
  if (!body.request_id && requestId) body.request_id = requestId;
  return new ApiError(response.status, body);
}

async function request<T>(method: string, path: string, init: RequestInit2 = {}, schema?: ZodType<T>): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.form) {
    body = init.form;
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = await ensureCsrfToken(init.signal);
  }
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, init.query), {
      method,
      headers,
      body,
      credentials: "include",
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw ApiError.network();
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => {
    throw new ApiError(502, { code: "INVALID_RESPONSE", message: "Le serveur a renvoyé une réponse illisible." });
  });
  if (!schema) return json as T;
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(502, { code: "INVALID_RESPONSE", message: "Le serveur a renvoyé une réponse incompatible avec le contrat attendu." });
  return parsed.data;
}

const get = <T>(path: string, init?: RequestInit2, schema?: ZodType<T>) => request<T>("GET", path, init, schema);
const post = <T>(path: string, init?: RequestInit2, schema?: ZodType<T>) => request<T>("POST", path, init, schema);
const patch = <T>(path: string, init?: RequestInit2) => request<T>("PATCH", path, init);
const del = <T>(path: string, init?: RequestInit2) => request<T>("DELETE", path, init);

export function createHttpApi(): KiosyApi {
  return {
    legal: {
      current: (documentId, opts) => get(`/v1/contract-documents/${encodeURIComponent(documentId)}/current`, { signal: opts?.signal }),
      get: (documentId, version, opts) => get(`/v1/contract-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(version)}`, { signal: opts?.signal }),
    },
    auth: {
      async getSession(opts) {
        let response: Response;
        try {
          response = await fetch(buildUrl("/v1/auth/session"), { credentials: "include", headers: { Accept: "application/json" }, signal: opts?.signal });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          throw ApiError.network();
        }
        if (response.status === 204 || response.status === 401) return null;
        if (!response.ok) throw await parseError(response);
        const json: unknown = await response.json();
        return sessionSchema.parse(json);
      },
      login: async (input) => { const session = await post("/v1/auth/login", { body: input }, sessionSchema); csrfToken = null; return session; },
      register: async (input) => { const session = await post("/v1/auth/register", { body: input }, sessionSchema); csrfToken = null; return session; },
      logout: async () => { await post("/v1/auth/logout"); csrfToken = null; },
      requestPasswordReset: (input) => post("/v1/auth/password/forgot", { body: input }),
      resetPassword: (input) => post("/v1/auth/password/reset", { body: input }),
      listSessions: (opts) => get("/v1/me/sessions", { signal: opts?.signal }),
      revokeSession: (id) => del(`/v1/me/sessions/${encodeURIComponent(id)}`),
      updatePreferences: (input) => patch("/v1/me/preferences", { body: input }),
    },
    catalog: {
      search: (query, opts) => get("/v1/publications", { query: { ...query }, signal: opts?.signal }),
      featured: (opts) => get("/v1/publications/featured", { signal: opts?.signal }),
      getPublication: (id, opts) => get(`/v1/publications/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      getExcerpt: (editionId, opts) => get(`/v1/editions/${encodeURIComponent(editionId)}/excerpt`, { signal: opts?.signal }),
    },
    offers: {
      list: (filter, opts) => get("/v1/offers", { query: filter, signal: opts?.signal }),
      get: (id, opts) => get(`/v1/offers/${encodeURIComponent(id)}`, { signal: opts?.signal }, offerSchema),
    },
    me: {
      library: (opts) => get("/v1/me/library", { signal: opts?.signal }),
      access: (publicationId, opts) => get("/v1/me/access", { query: { publication_id: publicationId }, signal: opts?.signal }),
      eligibility: (offerIds, opts) => get("/v1/me/eligibility", { query: { offer_ids: offerIds.join(",") }, signal: opts?.signal }),
      assetAccess: async (editionId, opts) => {
        // Le contrat du cahier des charges expose GET /v1/assets/{id}/access ; l'édition porte l'asset_id.
        const detail = await get<{ asset_id: string }>(`/v1/editions/${encodeURIComponent(editionId)}/asset`, { signal: opts?.signal });
        return get(`/v1/assets/${encodeURIComponent(detail.asset_id)}/access`, { signal: opts?.signal }, assetAccessSchema);
      },
      orders: (opts) => get("/v1/me/orders", { signal: opts?.signal }),
      subscriptions: (opts) => get("/v1/me/subscriptions", { signal: opts?.signal }),
      subscription: (id, opts) => get(`/v1/me/subscriptions/${encodeURIComponent(id)}`, { signal: opts?.signal }),
    },
    commerce: {
      quote: (input, opts) => post("/v1/orders/quote", { body: input, signal: opts?.signal }, quoteSchema),
      createOrder: (input, opts) => post("/v1/orders", { body: input, idempotencyKey: opts.idempotencyKey }, orderSchema),
      getOrder: (id, opts) => get(`/v1/orders/${encodeURIComponent(id)}`, { signal: opts?.signal }, orderSchema),
      createCheckout: (id, opts) => post(`/v1/orders/${encodeURIComponent(id)}/checkout`, { idempotencyKey: opts.idempotencyKey }),
    },
    proposals: {
      get: (id, opts) => get(`/v1/proposals/${encodeURIComponent(id)}`, { signal: opts?.signal }, proposalSchema),
      confirm: (id, opts) => post(`/v1/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey: opts.idempotencyKey }, proposalSchema),
      reject: (id, opts) => post(`/v1/proposals/${encodeURIComponent(id)}/reject`, { idempotencyKey: opts.idempotencyKey }, proposalSchema),
      prepareCancellation: (subId) => post(`/v1/subscriptions/${encodeURIComponent(subId)}/cancellation-proposals`),
      preparePlanChange: (subId, target) =>
        post(`/v1/subscriptions/${encodeURIComponent(subId)}/plan-change-proposals`, { body: { target_offer_id: target } }),
    },
    assistant: {
      listConversations: (opts) => get("/v1/conversations", { signal: opts?.signal }),
      createConversation: () => post("/v1/conversations"),
      getConversation: (id, opts) => get(`/v1/conversations/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      listMessages: (id, opts) => get(`/v1/conversations/${encodeURIComponent(id)}/messages`, { signal: opts?.signal }),
      startRun: (id, input, opts) =>
        post(`/v1/conversations/${encodeURIComponent(id)}/runs`, { body: input, idempotencyKey: opts.idempotencyKey }),
      getRun: (id, opts) => get(`/v1/runs/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      listRunEvents: (id, afterSeq, opts) =>
        get(`/v1/runs/${encodeURIComponent(id)}/events`, { query: { after_seq: afterSeq }, signal: opts?.signal }, runEventsSchema),
      followRun(runId, afterSeq, handlers) {
        const stream =
          typeof EventSource === "undefined"
            ? null
            : {
                open(after: number, onEvent: (e: RunEvent) => void, onError: () => void, onOpen: () => void) {
                  const source = new EventSource(buildUrl(`/v1/runs/${encodeURIComponent(runId)}/events`, { after_seq: after }), {
                    withCredentials: true,
                  });
                  source.onmessage = (message) => {
                    try {
                      const parsed = runEventSchema.safeParse(JSON.parse(message.data));
                      if (parsed.success) onEvent(parsed.data);
                    } catch {
                      // Événement illisible ignoré ; la relecture par séquence comblera le trou.
                    }
                  };
                  source.onerror = () => onError();
                  source.onopen = () => onOpen();
                  return () => source.close();
                },
              };
        return followEvents({
          afterSeq,
          stream,
          poll: (after) => get<RunEvent[]>(`/v1/runs/${encodeURIComponent(runId)}/events`, { query: { after_seq: after } }),
          onEvent: handlers.onEvent,
          onConnectionChange: handlers.onConnectionChange,
          pollIntervalMs: appConfig.assistant.pollIntervalMs,
          retryDelayMs: appConfig.assistant.sseRetryDelayMs,
        });
      },
      cancelRun: (id) => post(`/v1/runs/${encodeURIComponent(id)}/cancel`),
      sendFeedback: (id, input) => post(`/v1/messages/${encodeURIComponent(id)}/feedback`, { body: input }),
    },
    support: {
      list: (opts) => get("/v1/me/support-cases", { signal: opts?.signal }),
      get: (id, opts) => get(`/v1/support-cases/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      create: (input, opts) => post("/v1/support-cases", { body: input, idempotencyKey: opts.idempotencyKey }),
      reply: (id, body, opts) =>
        post(`/v1/support-cases/${encodeURIComponent(id)}/messages`, { body: { body }, idempotencyKey: opts.idempotencyKey }),
    },
    admin: {
      ops: (opts) => get("/v1/admin/ops", { signal: opts?.signal }),
      publishers: (opts) => get("/v1/admin/publishers", { signal: opts?.signal }),
      editions: (filter, opts) => get("/v1/admin/editions", { query: filter, signal: opts?.signal }),
      edition: (id, opts) => get(`/v1/admin/editions/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      createPublication: (input) => post("/v1/admin/publications", { body: input }),
      createEdition: (publicationId, input) => post(`/v1/admin/publications/${encodeURIComponent(publicationId)}/editions`, { body: input }),
      updatePublication: (id, input) => patch(`/v1/admin/publications/${encodeURIComponent(id)}`, { body: input }),
      updateEdition: (id, input) => patch(`/v1/admin/editions/${encodeURIComponent(id)}`, { body: input }),
      transitionEdition: (id, input) => post(`/v1/admin/editions/${encodeURIComponent(id)}/transitions`, { body: input }),
      offers: (opts) => get("/v1/admin/offers", { signal: opts?.signal }),
      createOffer: (input) => post("/v1/admin/offers", { body: input }, offerSchema),
      offerVersions: (id, opts) => get(`/v1/admin/offers/${encodeURIComponent(id)}/versions`, { signal: opts?.signal }),
      updateOffer: (id, input) => post(`/v1/admin/offers/${encodeURIComponent(id)}/versions`, { body: input }),
      imports: (opts) => get("/v1/admin/imports", { signal: opts?.signal }),
      publisherReviews: (opts) => get("/v1/publisher/reviews", { signal: opts?.signal }),
      publisherAnalytics: (opts) => get("/v1/publisher/analytics", { signal: opts?.signal }),
      uploadImport: (input, opts) => {
        const form = new FormData();
        form.set("file", input.file);
        form.set("edition_id", input.edition_id);
        return post("/v1/admin/imports", { form, idempotencyKey: opts.idempotencyKey });
      },
      orders: (filter, opts) => get("/v1/admin/orders", { query: filter, signal: opts?.signal }),
      reconcilePayment: (id) => post(`/v1/admin/orders/${encodeURIComponent(id)}/reconcile`),
      subscriptions: (opts) => get("/v1/admin/subscriptions", { signal: opts?.signal }),
      users: (opts) => get("/v1/admin/users", { signal: opts?.signal }),
      entitlements: (userId, opts) => get("/v1/admin/entitlements", { query: { user_id: userId }, signal: opts?.signal }),
      supportCases: (filter, opts) => get("/v1/admin/support-cases", { query: filter, signal: opts?.signal }),
      supportCase: (id, opts) => get(`/v1/admin/support-cases/${encodeURIComponent(id)}`, { signal: opts?.signal }),
      replySupportCase: (id, input, opts) =>
        post(`/v1/admin/support-cases/${encodeURIComponent(id)}/messages`, { body: input, idempotencyKey: opts.idempotencyKey }),
      requestAccessException: (caseId, input) =>
        post(`/v1/admin/support-cases/${encodeURIComponent(caseId)}/access-exceptions`, { body: input }),
      approvals: (opts) => get("/v1/admin/approvals", { signal: opts?.signal }),
      decideApproval: (id, input, opts) =>
        post(`/v1/admin/approvals/${encodeURIComponent(id)}/decision`, { body: input, idempotencyKey: opts.idempotencyKey }),
      audit: (filter, opts) => get("/v1/admin/audit-events", { query: filter, signal: opts?.signal }),
      runs: (opts) => get("/v1/admin/runs", { signal: opts?.signal }),
      run: (id, opts) => get(`/v1/admin/runs/${encodeURIComponent(id)}`, { signal: opts?.signal }),
    },
  };
}
