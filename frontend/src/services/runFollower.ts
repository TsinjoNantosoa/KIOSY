import type { RunEvent } from "@/contracts/models";

/**
 * Suivi robuste des événements d'un run (API02, UX05) :
 * - livraison dans l'ordre strict des numéros de séquence ;
 * - déduplication (un événement déjà livré est ignoré) ;
 * - trou de séquence => relecture par polling à partir du dernier numéro livré ;
 * - coupure du flux => polling de secours puis nouvelle tentative de flux.
 * Une coupure n'est jamais transformée en échec métier.
 */

export interface StreamSource {
  /** Ouvre un flux à partir de `afterSeq`. Retourne une fonction de fermeture. */
  open(afterSeq: number, onEvent: (event: RunEvent) => void, onError: () => void, onOpen: () => void): () => void;
}

export interface FollowerOptions {
  afterSeq: number;
  stream: StreamSource | null;
  poll: (afterSeq: number) => Promise<RunEvent[]>;
  onEvent: (event: RunEvent) => void;
  onConnectionChange?: (state: "live" | "reconnecting" | "polling") => void;
  pollIntervalMs: number;
  retryDelayMs: number;
  maxStreamRetries?: number;
}

export function followEvents(options: FollowerOptions): () => void {
  let lastSeq = options.afterSeq;
  const buffer = new Map<number, RunEvent>();
  let stopped = false;
  let closeStream: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let streamFailures = 0;
  let polling = false;
  const maxRetries = options.maxStreamRetries ?? 5;

  const flush = () => {
    let next = buffer.get(lastSeq + 1);
    while (next && !stopped) {
      buffer.delete(next.seq);
      lastSeq = next.seq;
      options.onEvent(next);
      next = buffer.get(lastSeq + 1);
    }
  };

  const accept = (event: RunEvent) => {
    if (stopped || event.seq <= lastSeq || buffer.has(event.seq)) return;
    buffer.set(event.seq, event);
    flush();
    if (buffer.size > 0) void pollOnce(); // trou détecté : on relit depuis lastSeq
  };

  const pollOnce = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const events = await options.poll(lastSeq);
      [...events].sort((a, b) => a.seq - b.seq).forEach(accept);
      // Les éléments encore bufferisés au-delà d'un trou non comblé sont conservés.
    } catch {
      // Erreur transitoire : le prochain cycle réessaiera.
    } finally {
      polling = false;
      // Trou toujours présent : nouvelle relecture différée, même si le flux reste ouvert.
      if (!stopped && buffer.size > 0 && !gapTimer) {
        gapTimer = setTimeout(() => {
          gapTimer = null;
          void pollOnce();
        }, options.pollIntervalMs);
      }
    }
  };

  const schedulePolling = () => {
    if (stopped || pollTimer) return;
    const loop = async () => {
      pollTimer = null;
      await pollOnce();
      if (!stopped && !closeStream) pollTimer = setTimeout(loop, options.pollIntervalMs);
    };
    pollTimer = setTimeout(loop, 0);
  };

  const openStream = () => {
    if (stopped || !options.stream) return;
    closeStream = options.stream.open(
      lastSeq,
      (event) => {
        streamFailures = 0;
        accept(event);
      },
      () => {
        closeStream?.();
        closeStream = null;
        streamFailures += 1;
        options.onConnectionChange?.(streamFailures > maxRetries ? "polling" : "reconnecting");
        schedulePolling();
        if (streamFailures <= maxRetries) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = null;
            }
            openStream();
          }, options.retryDelayMs * streamFailures);
        }
      },
      () => options.onConnectionChange?.("live"),
    );
  };

  if (options.stream) {
    options.onConnectionChange?.("reconnecting");
    openStream();
    // Relecture initiale : couvre les événements émis avant l'ouverture du flux.
    void pollOnce();
  } else {
    options.onConnectionChange?.("polling");
    schedulePolling();
  }

  return () => {
    stopped = true;
    closeStream?.();
    closeStream = null;
    if (pollTimer) clearTimeout(pollTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (gapTimer) clearTimeout(gapTimer);
    buffer.clear();
  };
}
