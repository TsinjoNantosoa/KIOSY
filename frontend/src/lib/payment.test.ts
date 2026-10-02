import { paymentModeLabel } from "./payment";

it("distingue les trois modes de paiement", () => {
  expect(paymentModeLabel("test")).toBe("Paiement de test");
  expect(paymentModeLabel("sandbox")).toBe("Paiement sandbox");
  expect(paymentModeLabel("live")).toBe("Paiement réel");
});
