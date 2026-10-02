import { act, renderHook } from "@testing-library/react";
import { useIdempotencyKey } from "./idempotency";

describe("useIdempotencyKey", () => {
  beforeEach(() => sessionStorage.clear());

  it("reprend la même intention après remontage et isole les comptes", () => {
    const intent = { offer_id: "off-1", version: 2 };
    const first = renderHook(() => useIdempotencyKey("user-a", "order:off-1"));
    let keyA = "";
    act(() => { keyA = first.result.current.keyFor(intent); });
    first.unmount();

    const resumed = renderHook(() => useIdempotencyKey("user-a", "order:off-1"));
    let resumedKey = "";
    act(() => { resumedKey = resumed.result.current.keyFor(intent); });
    expect(resumedKey).toBe(keyA);

    const otherAccount = renderHook(() => useIdempotencyKey("user-b", "order:off-1"));
    let otherKey = "";
    act(() => { otherKey = otherAccount.result.current.keyFor(intent); });
    expect(otherKey).not.toBe(keyA);
  });

  it("crée une nouvelle clé pour une intention matériellement différente", () => {
    const hook = renderHook(() => useIdempotencyKey("user-a", "order:off-1"));
    let first = "";
    let second = "";
    act(() => { first = hook.result.current.keyFor({ version: 1 }); });
    act(() => { second = hook.result.current.keyFor({ version: 2 }); });
    expect(second).not.toBe(first);
  });
});
