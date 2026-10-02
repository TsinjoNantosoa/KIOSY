/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1rem", md: "1.5rem", lg: "2rem" }, screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          strong: "rgb(var(--brand-strong) / <alpha-value>)",
          soft: "rgb(var(--brand-soft) / <alpha-value>)",
        },
        warm: { DEFAULT: "rgb(var(--warm) / <alpha-value>)", soft: "rgb(var(--warm-soft) / <alpha-value>)" },
        danger: { DEFAULT: "rgb(var(--danger) / <alpha-value>)", soft: "rgb(var(--danger-soft) / <alpha-value>)" },
        caution: { DEFAULT: "rgb(var(--caution) / <alpha-value>)", soft: "rgb(var(--caution-soft) / <alpha-value>)" },
        info: { DEFAULT: "rgb(var(--info) / <alpha-value>)", soft: "rgb(var(--info-soft) / <alpha-value>)" },
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', "Georgia", "serif"],
        sans: ['"Inter Variable"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: { card: "0.625rem" },
      boxShadow: {
        card: "0 1px 2px rgb(27 34 48 / 0.06), 0 1px 1px rgb(27 34 48 / 0.04)",
        lift: "0 8px 24px -8px rgb(27 34 48 / 0.18)",
      },
      maxWidth: { prose: "68ch" },
    },
  },
  plugins: [],
};
