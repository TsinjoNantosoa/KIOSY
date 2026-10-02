import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { clock, resetDemoDb, setDemoSessionUserId } from "@/mocks/db";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clock.reset();
  resetDemoDb();
  setDemoSessionUserId(null);
});

afterEach(() => cleanup());

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
