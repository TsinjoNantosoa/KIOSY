import { useSyncExternalStore } from "react";

/**
 * État d'interface minimal du panneau KIA (ouvert/fermé, message pré-rempli).
 * Les données de conversation restent dans TanStack Query, pas dans ce store.
 */
interface PanelState {
  isOpen: boolean;
  prefill: string | null;
  open: (prefill?: string) => void;
  close: () => void;
  consumePrefill: () => string | null;
}

let state: Omit<PanelState, "open" | "close" | "consumePrefill"> = { isOpen: false, prefill: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const actions = {
  open(prefill?: string) {
    state = { isOpen: true, prefill: prefill ?? null };
    emit();
  },
  close() {
    state = { ...state, isOpen: false };
    emit();
  },
  consumePrefill() {
    const value = state.prefill;
    if (value !== null) {
      state = { ...state, prefill: null };
      emit();
    }
    return value;
  },
};

let snapshot: PanelState = { ...state, ...actions };
function getSnapshot(): PanelState {
  if (snapshot.isOpen !== state.isOpen || snapshot.prefill !== state.prefill) snapshot = { ...state, ...actions };
  return snapshot;
}

export function useAssistantPanel<T>(selector: (s: PanelState) => T): T {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    getSnapshot,
  );
  return selector(current);
}

export const assistantPanel = actions;
