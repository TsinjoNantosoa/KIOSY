import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRun, Message, RunEvent, RunStatus } from "@/contracts/models";
import { useIdempotencyKey } from "@/lib/idempotency";
import { api } from "@/services/api";
import { qk } from "@/services/queryKeys";
import { useUid } from "@/features/auth/session";

export const ACTIVE_STATUSES: RunStatus[] = ["queued", "running", "waiting_user", "waiting_approval"];
export const isActive = (status: RunStatus | undefined) => Boolean(status && ACTIVE_STATUSES.includes(status));

/** Applique un événement à l'état local du run (ordre garanti par le follower). */
export function applyRunEvent(run: AgentRun, event: RunEvent): AgentRun {
  if (event.seq <= run.last_seq) return run;
  const next: AgentRun = { ...run, last_seq: event.seq, updated_at: event.at, steps: [...run.steps] };
  if (event.type === "status") next.status = event.status;
  if (event.type === "error") next.error = { code: event.code, message: event.message };
  if (event.type === "step") {
    const index = next.steps.findIndex((s) => s.key === event.step.key);
    if (index >= 0) next.steps[index] = event.step;
    else next.steps.push(event.step);
  }
  return next;
}

// ------------------------------------------------------------------ conversation courante (reprise UX05)

const currentKey = (uid: string) => `kiosy-kia-current-${uid}`;
export function readCurrentConversation(uid: string): string | null {
  try {
    return sessionStorage.getItem(currentKey(uid));
  } catch {
    return null;
  }
}
export function writeCurrentConversation(uid: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(currentKey(uid), id);
    else sessionStorage.removeItem(currentKey(uid));
  } catch {
    // stockage indisponible : la conversation reste accessible depuis l'historique
  }
}

export function useConversations() {
  const uid = useUid();
  const authed = uid !== "anon";
  return useQuery({
    queryKey: qk.conversations(uid),
    queryFn: ({ signal }) => api.assistant.listConversations({ signal }),
    enabled: authed,
  });
}

export function useConversation(conversationId: string | null) {
  const uid = useUid();
  const conversation = useQuery({
    queryKey: qk.conversation(uid, conversationId ?? ""),
    queryFn: ({ signal }) => api.assistant.getConversation(conversationId!, { signal }),
    enabled: Boolean(conversationId),
  });
  const messages = useQuery({
    queryKey: qk.messages(uid, conversationId ?? ""),
    queryFn: ({ signal }) => api.assistant.listMessages(conversationId!, { signal }),
    enabled: Boolean(conversationId),
  });
  return { conversation, messages };
}

/** Suit un run en cours ; s'arrête dès que le run n'est plus actif. Une coupure n'est pas un échec. */
export function useRunFollower(runId: string | null, conversationId: string | null) {
  const uid = useUid();
  const client = useQueryClient();
  const [connection, setConnection] = useState<"live" | "reconnecting" | "polling">("reconnecting");
  const run = useQuery({
    queryKey: qk.run(uid, runId ?? ""),
    queryFn: ({ signal }) => api.assistant.getRun(runId!, { signal }),
    enabled: Boolean(runId),
    staleTime: Infinity,
  });
  const lastSeq = useRef(0);
  lastSeq.current = run.data?.last_seq ?? 0;
  const active = isActive(run.data?.status);

  useEffect(() => {
    if (!runId || !active) return;
    const refreshMessages = () => {
      if (conversationId) client.invalidateQueries({ queryKey: qk.messages(uid, conversationId) });
    };
    const stop = api.assistant.followRun(runId, lastSeq.current, {
      onEvent: (event) => {
        client.setQueryData<AgentRun>(qk.run(uid, runId), (prev) => (prev ? applyRunEvent(prev, event) : prev));
        if (event.type === "message") refreshMessages();
        if (event.type === "status" && !ACTIVE_STATUSES.includes(event.status)) {
          refreshMessages();
          client.invalidateQueries({ queryKey: qk.conversations(uid) });
          if (conversationId) client.invalidateQueries({ queryKey: qk.conversation(uid, conversationId) });
        }
      },
      onConnectionChange: setConnection,
    });
    return stop;
  }, [runId, active, uid, conversationId, client]);

  const cancel = useMutation({
    mutationFn: () => api.assistant.cancelRun(runId!),
    onSuccess: (updated) => {
      client.setQueryData(qk.run(uid, runId!), updated);
      if (conversationId) client.invalidateQueries({ queryKey: qk.messages(uid, conversationId) });
    },
  });

  return { run, connection: active ? connection : "live", cancel };
}

/** Envoi d'un message : crée la conversation si besoin, puis démarre un run (202 + run_id). */
export function useSendMessage(conversationId: string | null, onConversation: (id: string | null) => void, onRun: (runId: string) => void) {
  const uid = useUid();
  const client = useQueryClient();
  const { keyFor, reset } = useIdempotencyKey(uid, `assistant:${conversationId ?? "new"}`);
  const draft = useRef(0);
  const mutation = useMutation({
    mutationFn: async (text: string) => {
      let id = conversationId;
      if (!id) {
        const created = await api.assistant.createConversation();
        id = created.id;
        onConversation(id);
      }
      const response = await api.assistant.startRun(id, { text }, { idempotencyKey: keyFor({ id, text, draft: draft.current }) });
      return { conversationId: id, response };
    },
    onSuccess: ({ conversationId: id, response }) => {
      draft.current += 1;
      reset();
      client.setQueryData<Message[]>(qk.messages(uid, id), (prev) => (prev?.some((m) => m.id === response.user_message.id) ? prev : [...(prev ?? []), response.user_message]));
      client.invalidateQueries({ queryKey: qk.conversations(uid) });
      // La vue a pu être remontée entre-temps (navigation vers /kia/:id) : elle relira le run actif.
      client.invalidateQueries({ queryKey: qk.conversation(uid, id) });
      onRun(response.run_id);
    },
  });
  const send = useCallback((text: string) => {
    if (mutation.isPending) return;
    mutation.mutate(text);
  }, [mutation]);
  return { send, mutation };
}
