import { appConfig } from "@/config/app";

export interface LocalCheck {
  label: string;
  ok: boolean;
}

/**
 * Validation INDICATIVE côté navigateur (taille, extension, signature PDF). Elle évite un envoi
 * inutile mais ne remplace pas la validation serveur ni l'analyse en quarantaine (CAT05, SEC05).
 */
export async function checkFileLocally(file: File): Promise<LocalCheck[]> {
  const name = file.name.toLowerCase();
  const ext = appConfig.upload.acceptedExtensions.find((e) => name.endsWith(e));
  const checks: LocalCheck[] = [
    { label: `Taille ≤ ${Math.round(appConfig.upload.maxBytes / 1_000_000)} Mo`, ok: file.size > 0 && file.size <= appConfig.upload.maxBytes },
    { label: `Extension autorisée (${appConfig.upload.acceptedExtensions.join(", ")})`, ok: Boolean(ext) },
    { label: "Nom de fichier sans chemin", ok: !/[\\/]|\.\./.test(file.name) },
  ];
  if (ext === ".pdf") {
    const head = await file.slice(0, 5).text().catch(() => "");
    checks.push({ label: "Signature PDF (%PDF-) présente", ok: head === "%PDF-" });
  }
  return checks;
}
