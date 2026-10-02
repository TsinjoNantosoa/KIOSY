import { createHttpApi } from "./http";
import type { KiosyApi } from "./types";

export const api: KiosyApi = createHttpApi();
export type { KiosyApi } from "./types";
