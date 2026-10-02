import { formatCountdown, formatDate, formatMoney } from "./format";

const SPACE = String.fromCharCode(32);
const nbsp = (s: string) => s.replace(/\s/g, SPACE);

describe("formatMoney", () => {
  it("formate l'ariary sans décimales (scale 0)", () => {
    expect(nbsp(formatMoney({ amount: 15000, currency: "MGA", scale: 0 }))).toBe("15 000 MGA");
  });
  it("respecte une échelle explicite à deux décimales", () => {
    expect(nbsp(formatMoney({ amount: 1250, currency: "EUR", scale: 2 }))).toBe("12,50 €");
  });
  it("affiche Gratuit pour un montant nul", () => {
    expect(formatMoney({ amount: 0, currency: "MGA", scale: 0 })).toBe("Gratuit");
  });
});

describe("formatDate", () => {
  it("affiche une date UTC dans le fuseau choisi", () => {
    const iso = "2026-09-30T22:30:00Z";
    expect(formatDate(iso, "Indian/Antananarivo")).toBe("1 octobre 2026");
    expect(formatDate(iso, "UTC")).toBe("30 septembre 2026");
  });
});

describe("formatCountdown", () => {
  it("affiche minutes et secondes", () => {
    expect(formatCountdown(125_000)).toBe("2 min 05 s");
    expect(formatCountdown(0)).toBe("0 s");
  });
});
