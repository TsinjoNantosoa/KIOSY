import { Link, useNavigate, useParams } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { brand } from "@/config/app";
import { Button } from "@/components/ui/Button";
import { ErrorState, LoadingBlock } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { t } from "@/locales";
import { useSession, useTimeZone, useUid } from "@/features/auth/session";
import { ConversationView } from "./ConversationView";
import { useConversations, writeCurrentConversation } from "./useAssistant";

export default function AssistantPage() {
  useDocumentTitle(`${brand.assistantName} · ${brand.name}`);
  const { conversationId = null } = useParams();
  const navigate = useNavigate();
  const { status: sessionStatus } = useSession();
  const uid = useUid();
  const tz = useTimeZone();
  const conversations = useConversations();
  const needsLogin = sessionStatus === "anonymous" || uid === "anon";

  const open = (id: string | null) => {
    writeCurrentConversation(uid, id);
    navigate(id ? `/kia/${id}` : "/kia");
  };

  return (
    <div className="container py-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[17rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t.assistant.history}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold">{brand.assistantName}</h1>
            <Button size="sm" variant="outline" onClick={() => open(null)} icon={<MessageSquarePlus className="h-4 w-4" aria-hidden />}>
              Nouvelle
            </Button>
          </div>
          {conversations.isPending ? (
            <LoadingBlock lines={3} />
          ) : conversations.isError ? (
            <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
          ) : conversations.data.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucune conversation pour l'instant.</p>
          ) : (
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0">
              {conversations.data.map((c) => (
                <li key={c.id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    aria-current={c.id === conversationId ? "page" : undefined}
                    className={cn("w-56 rounded-md border px-3 py-2 text-left text-sm hover:border-brand lg:w-full", c.id === conversationId ? "border-brand bg-brand-soft" : "border-line bg-surface")}
                  >
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="text-xs text-ink-muted">{formatDateShort(c.updated_at, tz)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="card-surface flex h-[calc(100dvh-10rem)] min-h-[28rem] flex-col overflow-hidden" aria-label="Conversation">
          {needsLogin ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="max-w-md text-ink-muted">Connectez-vous pour discuter avec {brand.assistantName} et retrouver vos conversations.</p>
              <Link to="/connexion?redirect=/kia" className="inline-flex">
                <Button type="button">Se connecter</Button>
              </Link>
            </div>
          ) : (
            <ConversationView key={conversationId ?? "new"} conversationId={conversationId} onConversationChange={(id) => open(id)} />
          )}
        </section>
      </div>
    </div>
  );
}
