import { z } from "zod";

/** Schémas des formulaires éditoriaux. La validation serveur reste l'autorité. */
export const publicationSchema = z.object({
  title: z.string().trim().min(2, "Titre trop court.").max(120),
  author: z.string().trim().min(2, "Auteur requis.").max(120),
  publisher_id: z.string().min(1, "Choisissez un éditeur."),
  universe: z.enum(["presse", "business", "culture"]),
  language: z.enum(["fr", "mg", "en"]),
  summary: z.string().trim().min(20, "Résumé de 20 caractères minimum.").max(600),
  tags: z.string().max(200),
});

export const editionSchema = z.object({
  label: z.string().trim().min(2, "Libellé requis.").max(80),
  format: z.enum(["text", "pdf"]),
  published_at: z.string().min(1, "Date requise."),
  public_excerpt: z.boolean(),
  ai_indexing: z.boolean(),
  is_free: z.boolean(),
});

export type PublicationValues = z.infer<typeof publicationSchema>;
export type EditionValues = z.infer<typeof editionSchema>;

export const splitTags = (tags: string) =>
  tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

/** Date du champ <input type="date"> interprétée à midi UTC pour éviter les décalages de fuseau. */
export const dateInputToIso = (value: string) => new Date(`${value}T12:00:00Z`).toISOString();
export const isoToDateInput = (iso: string) => iso.slice(0, 10);
