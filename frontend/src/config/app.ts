/**
 * Configuration centrale du frontend.
 *
 * Les noms « Kiosy » et « KIA » sont provisoires (cahier des charges, page 1) :
 * ils ne doivent apparaître qu'ici, les composants lisent `brand`.
 * Toutes les variables VITE_* sont publiques et incluses dans le bundle.
 */

export type AppMode = "demo" | "api";

function readMode(): AppMode {
  const raw = import.meta.env.VITE_APP_MODE;
  if (raw === undefined || raw === "") return "demo";
  if (raw === "api" || raw === "demo") return raw;
  throw new Error(`VITE_APP_MODE invalide : "${raw}". Valeurs autorisÃ©es : demo, api.`);
}

function readNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const brand = {
  name: "Kiosy",
  assistantName: "KIA",
  tagline: "Presse, business et culture, réunis dans un même kiosque numérique.",
  /** Adresse de contact à définir avant pilote : domaine .invalid volontairement non routable. */
  contactEmail: "contact@kiosy.invalid",
} as const;

export const appConfig = {
  mode: readMode(),
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
  assetAllowedOrigins: (import.meta.env.VITE_ASSET_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean),
  demoLatencyMs: readNumber(import.meta.env.VITE_DEMO_LATENCY_MS, 350),
  locale: "fr-FR",
  defaultTimeZone: "Indian/Antananarivo",
  /** Fuseaux proposés dans le profil. Hypothèse : lecteurs à Madagascar et diaspora. */
  timeZones: ["Indian/Antananarivo", "Indian/Reunion", "Indian/Mauritius", "Europe/Paris", "America/Montreal", "UTC"],
  catalog: { pageSize: 12, searchDebounceMs: 300 },
  checkout: {
    /** Intervalle et nombre de relectures du statut autoritaire après retour du prestataire. */
    statusPollIntervalMs: 1500,
    statusPollMaxAttempts: 8,
  },
  assistant: {
    maxMessageLength: 2000,
    pollIntervalMs: 1500,
    sseRetryDelayMs: 2000,
  },
  upload: {
    /** Validation indicative côté navigateur ; le serveur reste l'autorité (CAT05). */
    maxBytes: 50 * 1024 * 1024,
    acceptedExtensions: [".pdf", ".md", ".txt"],
  },
} as const;

export const isDemo = appConfig.mode === "demo";

/** Le mode api exige une URL d'API HTTPS (http toléré uniquement en local). */
export function configProblem(): string | null {
  if (appConfig.mode !== "api") return null;
  if (!appConfig.apiBaseUrl) return "VITE_API_BASE_URL n'est pas défini alors que VITE_APP_MODE=api.";
  try {
    const url = new URL(appConfig.apiBaseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return "VITE_API_BASE_URL doit utiliser HTTPS hors environnement local.";
  } catch {
    return "VITE_API_BASE_URL n'est pas une URL valide.";
  }
  return null;
}
