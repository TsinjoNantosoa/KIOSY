import { describe, expect, it } from "vitest";
import { classifyLink } from "./safeUrl";

describe("classifyLink", () => {
  it("autorise HTTPS et les paiements HTTP strictement locaux", () => {
    expect(classifyLink("https://payments.example/checkout").kind).toBe("external");
    expect(classifyLink("http://127.0.0.1:8000/v1/test-payments/session").kind).toBe("external");
    expect(classifyLink("http://localhost:8000/v1/test-payments/session").kind).toBe("external");
  });

  it("refuse HTTP distant et les protocoles actifs", () => {
    expect(classifyLink("http://payments.example/checkout").kind).toBe("unsafe");
    expect(classifyLink("javascript:alert(1)").kind).toBe("unsafe");
    expect(classifyLink("data:text/html,unsafe").kind).toBe("unsafe");
  });
});
