import { useCallback, useRef } from "react";

const STORAGE_PREFIX = "kiosy:idempotency:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredIntent {
  fingerprint: string;
  key: string;
  createdAt: number;
}

function storageKey(accountId: string, operation: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(operation)}`;
}

function readStored(accountId: string, operation: string): StoredIntent | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(accountId, operation));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredIntent>;
    if (typeof value.fingerprint !== "string" || typeof value.key !== "string" || typeof value.createdAt !== "number" || Date.now() - value.createdAt > MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey(accountId, operation));
      return null;
    }
    return value as StoredIntent;
  } catch {
    return null;
  }
}

function writeStored(accountId: string, operation: string, value: StoredIntent | null) {
  if (typeof sessionStorage === "undefined") return;
  try {
    const key = storageKey(accountId, operation);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // Le stockage aide la reprise; le serveur reste responsable de l'idempotence.
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Cle d'idempotence liee a un compte, une operation et une intention.
 * sessionStorage permet la reprise dans le meme onglet apres rechargement pendant 24 h.
 * Aucune donnee de paiement, aucun secret et aucun document ne sont stockes.
 */
export function useIdempotencyKey(accountId = "anonymous", operation = "default") {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);

  const keyFor = useCallback((intent: unknown): string => {
    const fingerprint = JSON.stringify(intent ?? null);
    if (!ref.current || ref.current.fingerprint !== fingerprint) {
      const stored = readStored(accountId, operation);
      ref.current = stored?.fingerprint === fingerprint ? stored : { fingerprint, key: newIdempotencyKey() };
      writeStored(accountId, operation, { ...ref.current, createdAt: Date.now() });
    }
    return ref.current.key;
  }, [accountId, operation]);

  const reset = useCallback(() => {
    ref.current = null;
    writeStored(accountId, operation, null);
  }, [accountId, operation]);

  return { keyFor, reset };
}
