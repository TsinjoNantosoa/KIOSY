import { createDemoApi } from "@/mocks/demoApi";
import { createHttpApi } from "./http";
import type { KiosyApi } from "./types";

/**
 * Sélection explicite de l'adaptateur. En mode api, aucune substitution par les mocks :
 * une panne du backend remonte comme une erreur visible. La comparaison porte directement
 * sur la variable remplacée à la compilation pour que la branche inutilisée soit éliminée.
 */
export const api: KiosyApi = import.meta.env.VITE_APP_MODE === "api" ? createHttpApi() : createDemoApi();

export type { KiosyApi } from "./types";
