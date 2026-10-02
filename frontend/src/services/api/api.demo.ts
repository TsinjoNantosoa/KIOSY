import { createDemoApi } from "@/mocks/demoApi";
import type { KiosyApi } from "./types";

export const api: KiosyApi = createDemoApi();
export type { KiosyApi } from "./types";
