import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const appMode = process.env.VITE_APP_MODE ?? env.VITE_APP_MODE ?? "demo";
  return ({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/services\/api$/, replacement: path.resolve(rootDir, appMode === "api" ? "./src/services/api/api.http.ts" : "./src/services/api/api.demo.ts") },
      { find: "@", replacement: path.resolve(rootDir, "./src") },
    ],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          data: ["@tanstack/react-query", "zod", "react-hook-form", "@hookform/resolvers"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Les tests unitaires utilisent toujours le mode démonstration, sans latence.
    env: { VITE_APP_MODE: "demo", VITE_DEMO_LATENCY_MS: "0" },
  },
  });
});
