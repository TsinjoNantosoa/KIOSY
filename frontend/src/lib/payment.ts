export type PaymentMode = "test" | "sandbox" | "live";

export function paymentModeLabel(mode: PaymentMode): string {
  if (mode === "test") return "Paiement de test";
  if (mode === "sandbox") return "Paiement sandbox";
  return "Paiement réel";
}
