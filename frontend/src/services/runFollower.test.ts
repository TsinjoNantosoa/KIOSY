import type { RunEvent } from "@/contracts/models";
import { followEvents, type StreamSource } from "./runFollower";

const ev = (seq: number): RunEvent => ({ seq, run_id: "r", at: new Date(0).toISOString(), type: "status", status: "running" });

function manualStream() {
  let push: ((e: RunEvent) => void) | null = null;
  let fail: (() => void) | null = null;
  const source: StreamSource = {
    open(_after, onEvent, onError) {
      push = onEvent;
      fail = onError;
      return () => {
        push = null;
      };
    },
  };
  return { source, push: (e: RunEvent) => push?.(e), fail: () => fail?.() };
}

describe("followEvents", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("livre dans l'ordre, déduplique et comble un trou par relecture", async () => {
    const stream = manualStream();
    const store: RunEvent[] = [ev(1), ev(2), ev(3)];
    const poll = vi.fn(async (after: number) => store.filter((e) => e.seq > after));
    const seen: number[] = [];
    const stop = followEvents({ afterSeq: 0, stream: stream.source, poll, onEvent: (e) => seen.push(e.seq), pollIntervalMs: 1000, retryDelayMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1, 2, 3]); // relecture initiale
    stream.push(ev(2)); // doublon
    stream.push(ev(5)); // trou : 4 manquant
    expect(seen).toEqual([1, 2, 3]);
    store.push(ev(4), ev(5));
    await vi.advanceTimersByTimeAsync(1000); // relecture différée tant que le trou persiste
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    stop();
  });

  it("bascule en relecture périodique quand le flux coupe, sans échec métier", async () => {
    const stream = manualStream();
    const store: RunEvent[] = [];
    const states: string[] = [];
    const seen: number[] = [];
    const stop = followEvents({
      afterSeq: 0,
      stream: stream.source,
      poll: async (after) => store.filter((e) => e.seq > after),
      onEvent: (e) => seen.push(e.seq),
      onConnectionChange: (s) => states.push(s),
      pollIntervalMs: 500,
      retryDelayMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    stream.fail();
    expect(states).toContain("reconnecting");
    store.push(ev(1));
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual([1]);
    stop();
  });
});
