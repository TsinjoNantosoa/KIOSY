/**
 * Erreurs d'API normalisées (API01) : code, message public, request_id, détails non sensibles.
 */

export type ErrorKind =
  | "unauthenticated" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "validation" // 422
  | "rate_limited" // 429
  | "unavailable" // 503
  | "network" // aucune réponse
  | "unknown";

/** Codes métier proposés par le cahier des charges (section 13) et complétés pour le frontend. */
export type ErrorCode =
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "OFFER_CHANGED"
  | "OFFER_SOLD_OUT"
  | "OFFER_UNAVAILABLE"
  | "ALREADY_OWNED"
  | "APPROVAL_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "PROPOSAL_EXPIRED"
  | "PROPOSAL_STALE"
  | "PROPOSAL_ALREADY_DECIDED"
  | "SELF_APPROVAL_FORBIDDEN"
  | "IDEMPOTENCY_MISMATCH"
  | "INVALID_TRANSITION"
  | "RESERVATION_EXPIRED"
  | "SESSION_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
  details?: { field?: string; issue: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ErrorKind;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: { field?: string; issue: string }[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kindFromStatus(status);
    this.code = body.code;
    this.requestId = body.request_id ?? null;
    this.details = body.details ?? [];
  }

  static network(): ApiError {
    return new ApiError(0, { code: "NETWORK_ERROR", message: "Connexion impossible au service." });
  }
}

export function kindFromStatus(status: number): ErrorKind {
  switch (status) {
    case 0:
      return "network";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation";
    case 429:
      return "rate_limited";
    case 502:
    case 503:
    case 504:
      return "unavailable";
    default:
      return "unknown";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}
