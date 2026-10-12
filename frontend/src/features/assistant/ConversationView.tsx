import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, CheckCircle2, Circle, Loader2, LogIn, Send, Square, User, UserPlus, WifiOff, XCircle } from "lucide-react";
import { useLocation } from "react-router-dom";
import { appConfig, brand, isDemo } from "@/config/app";
import { isApiError } from "@/contracts/errors";
import type { AgentRun, Message } from "@/contracts/models";
import { RunStatusBadge } from "@/components/StatusBadges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, InlineError, LoadingBlock } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { t } from "@/locales";
import { useSession, useTimeZone } from "@/features/auth/session";
import { MessageBlocks, messageKind } from "./MessageBlocks";
import { assistantPanel } from "./panelState";
import { isActive, useConversation, useRunFollower, useSendMessage } from "./useAssistant";

const SUGGESTIONS = [
  "Conseille-moi une lecture culture",
  "Compare les abonnements",
  "Je veux une offre business et agriculture sans repayer mes accès",
  "Comment fonctionne la résiliation ?",
  "Je n'arrive pas à ouvrir l'Hebdo N° 213",
];

export function ConversationView({
  conversationId,
  onConversationChange,
  prefill,
  className,
}: {
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  prefill?: string | null;
  className?: string;
}) {
  const tz = useTimeZone();
  const session = useSession();
  const location = useLocation();
  const { conversation, messages } = useConversation(conversationId);
  const [runId, setRunId] = useState<string | null>(null);
  // Reprise après rechargement : le serveur indique le run encore actif de la conversation.
  const serverActiveRun = conversation.data?.active_run_id ?? null;
  useEffect(() => {
    if (serverActiveRun) setRunId(serverActiveRun);
  }, [serverActiveRun]);
  useEffect(() => setRunId(null), [conversationId]);
  // Conversation mémorisée devenue introuvable (autre compte, réinitialisation) : on repart à zéro.
  const missing = isApiError(conversation.error) && conversation.error.kind === "not_found";
  useEffect(() => {
    if (missing) onConversationChange(null);
  }, [missing, onConversationChange]);
  const { run, connection, cancel } = useRunFollower(runId, conversationId);
  const { send, mutation } = useSendMessage(conversationId, onConversationChange, setRunId);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const running = isActive(run.data?.status);

  useEffect(() => {
    if (prefill) setText(prefill);
  }, [prefill]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.data?.length, run.data?.steps.length]);

  const submit = (value = text) => {
    const trimmed = value.trim();
    if (!trimmed || running || mutation.isPending) return;
    send(trimmed);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const list = messages.data ?? [];
  const runInProgressError = isApiError(mutation.error) && mutation.error.code === "RUN_IN_PROGRESS";

  if (session.status === "loading") {
    return <div className={cn("flex-1 p-4", className)}><LoadingBlock lines={4} /></div>;
  }

  if (session.status === "anonymous") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <div className="flex flex-1 flex-col justify-center px-5 py-8">
          <div className="mx-auto max-w-md text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden>
              <Bot className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-serif text-xl font-semibold">Connectez-vous pour discuter avec {brand.assistantName}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              Votre session protège l'historique de vos conversations et permet à {brand.assistantName} de vérifier vos accès sans les exposer à un autre utilisateur.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
              <ButtonLink to={`/connexion?retour=${encodeURIComponent(returnTo)}`} onClick={() => assistantPanel.close()} icon={<LogIn className="h-4 w-4" aria-hidden />}>
                Se connecter
              </ButtonLink>
              <ButtonLink to={`/inscription?retour=${encodeURIComponent(returnTo)}`} onClick={() => assistantPanel.close()} variant="outline" icon={<UserPlus className="h-4 w-4" aria-hidden />}>
                Créer un compte
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (session.status === "unavailable") {
    return <div className={cn("flex-1 p-4", className)}><InlineError error={session.error} /></div>;
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-label="Messages de la conversation">
        {isDemo && (
          <p className="rounded-md bg-warm-soft px-3 py-2 text-xs text-ink">{t.assistant.simulated}</p>
        )}
        {conversationId && messages.isPending ? (
          <LoadingBlock lines={4} />
        ) : messages.isError ? (
          <InlineError error={messages.error} />
        ) : list.length === 0 ? (
          <Welcome onPick={(s) => submit(s)} />
        ) : (
          <ol className="space-y-4">
            {list.map((m) => (
              <MessageItem key={m.id} message={m} timeZone={tz} onQuickReply={(s) => submit(s)} />
            ))}
          </ol>
        )}
        {run.data && (running || run.data.status === "failed" || run.data.status === "cancelled") && <RunProgress run={run.data} connection={connection} />}
      </div>

      <div className="border-t border-line bg-surface p-3">
        {runInProgressError && <Alert tone="info" className="mb-2">Une réponse est déjà en cours pour cette conversation.</Alert>}
        {mutation.error && !runInProgressError && <div className="mb-2"><InlineError error={mutation.error} /></div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="kia-input" className="sr-only">Message pour {brand.assistantName}</label>
          <textarea
            id="kia-input"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, appConfig.assistant.maxMessageLength))}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={running ? "Réponse en cours…" : t.assistant.placeholder}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-md border border-line bg-paper px-3 py-2.5 text-[0.95rem] focus:border-brand focus:outline-none"
            aria-describedby="kia-help"
          />
          {running ? (
            <Button variant="outline" onClick={() => cancel.mutate()} loading={cancel.isPending} aria-label={t.assistant.stop} icon={<Square className="h-4 w-4" aria-hidden />}>
              <span className="hidden sm:inline">{t.assistant.stop}</span>
            </Button>
          ) : (
            <Button type="submit" loading={mutation.isPending} disabled={!text.trim()} aria-label={t.assistant.send} icon={<Send className="h-4 w-4" aria-hidden />}>
              <span className="hidden sm:inline">{t.assistant.send}</span>
            </Button>
          )}
        </form>
        <p id="kia-help" className="mt-1.5 text-xs text-ink-subtle">
          Entrée pour envoyer, Maj+Entrée pour aller à la ligne. {brand.assistantName} ne paie et ne modifie rien sans votre confirmation.
        </p>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="py-4">
      <p className="flex items-center gap-2 font-serif text-lg font-semibold"><Bot className="h-5 w-5 text-brand" aria-hidden /> Bonjour, je suis {brand.assistantName}.</p>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{t.assistant.intro}</p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">Exemples</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button type="button" onClick={() => onPick(s)} className="min-h-9 rounded-full border border-line bg-surface px-3 text-left text-sm hover:border-brand">
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageItem({ message, timeZone, onQuickReply }: { message: Message; timeZone: string; onQuickReply: (text: string) => void }) {
  const mine = message.role === "user";
  const kind = mine ? null : messageKind(message);
  return (
    <li className={cn("flex gap-2", mine && "flex-row-reverse")}>
      <span className={cn("mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full", mine ? "bg-ink text-white" : "bg-brand text-white")} aria-hidden>
        {mine ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className={cn("min-w-0 max-w-[88%] rounded-card px-3 py-2", mine ? "bg-ink text-white" : "border border-line bg-paper")}>
        <p className={cn("mb-1 text-[0.7rem]", mine ? "text-white/70" : "text-ink-subtle")}>
          <span className="sr-only">{mine ? "Vous" : brand.assistantName}, </span>
          {kind && <span className="mr-1 font-semibold uppercase tracking-wide">{t.assistant.kinds[kind === "prepared" ? "prepared" : kind]} ·</span>}
          {formatDateTime(message.created_at, timeZone)}
        </p>
        {mine ? (
          <p className="whitespace-pre-line text-[0.95rem]">{message.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n")}</p>
        ) : (
          <MessageBlocks message={message} onQuickReply={onQuickReply} />
        )}
      </div>
    </li>
  );
}

function RunProgress({ run, connection }: { run: AgentRun; connection: "live" | "reconnecting" | "polling" }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{brand.assistantName} {isActive(run.status) ? "travaille…" : ""}</p>
        <RunStatusBadge status={run.status} />
      </div>
      {run.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {run.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              {step.state === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden />
              ) : step.state === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />
              ) : step.state === "failed" ? (
                <XCircle className="h-4 w-4 text-danger" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-ink-subtle" aria-hidden />
              )}
              <span>{step.label}</span>
              <span className="sr-only">: {step.state === "running" ? "en cours" : step.state === "done" ? "terminé" : "échec"}</span>
            </li>
          ))}
        </ol>
      )}
      {connection !== "live" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          {connection === "reconnecting" ? t.assistant.reconnecting : t.assistant.polling}
        </p>
      )}
      {run.status === "cancelled" && <p className="mt-2 text-xs text-ink-muted">Traitement arrêté. Les actions déjà confirmées ne sont pas annulées.</p>}
    </div>
  );
}
