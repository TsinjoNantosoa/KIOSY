/**
 * Classement des liens provenant de contenus non fiables (réponses de l'assistant, Markdown).
 * Seuls les chemins internes et les URL https sont conservés ; javascript:, data:, etc. sont refusés.
 */
export type SafeLink = { kind: "internal"; to: string } | { kind: "external"; href: string } | { kind: "unsafe" };

export function classifyLink(raw: string): SafeLink {
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return { kind: "internal", to: value };
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return { kind: "external", href: url.toString() };
  } catch {
    // URL invalide
  }
  return { kind: "unsafe" };
}

/** Valide une URL de fichier renvoyée par l'API selon le contrat de déploiement. */
export function safeAssetUrl(raw: string, allowedOrigins: readonly string[]): string | null {
  try {
    const url = new URL(raw, typeof window === "undefined" ? "https://invalid.local" : window.location.href);
    if (url.protocol === "blob:") return raw.startsWith("blob:") ? raw : null;
    if (url.protocol !== "https:") return null;
    const sameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
    return sameOrigin || allowedOrigins.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}
