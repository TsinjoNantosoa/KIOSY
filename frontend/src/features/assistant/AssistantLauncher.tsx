import { useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2, MessageCircle, Plus } from "lucide-react";
import { brand } from "@/config/app";
import { Sheet } from "@/components/ui/Dialog";
import { t } from "@/locales";
import { useUid } from "@/features/auth/session";
import { ConversationView } from "./ConversationView";
import { assistantPanel, useAssistantPanel } from "./panelState";
import { readCurrentConversation, writeCurrentConversation } from "./useAssistant";

/** Point d'entrée global : bouton flottant et panneau (plein écran sur mobile). */
export function AssistantLauncher() {
  const isOpen = useAssistantPanel((s) => s.isOpen);
  const prefillState = useAssistantPanel((s) => s.prefill);
  return (
    <>
      <button
        type="button"
        onClick={() => assistantPanel.open()}
        className="fixed bottom-4 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-5 font-medium text-white shadow-lift hover:bg-brand-strong"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
        <span>{brand.assistantName}</span>
        <span className="sr-only"> — {t.assistant.open}</span>
      </button>
      {isOpen && <AssistantPanel prefill={prefillState} />}
    </>
  );
}

function AssistantPanel({ prefill }: { prefill: string | null }) {
  const uid = useUid();
  const [conversationId, setConversationId] = useState<string | null>(() => readCurrentConversation(uid));

  const change = (id: string | null) => {
    setConversationId(id);
    writeCurrentConversation(uid, id);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && assistantPanel.close()}
      title={`Assistant ${brand.assistantName}`}
      width="sm:max-w-lg"
      headerExtra={
        <>
          <button type="button" onClick={() => change(null)} className="rounded-md p-2 text-ink-muted hover:bg-sunken" aria-label={t.assistant.newConversation} title={t.assistant.newConversation}>
            <Plus className="h-5 w-5" aria-hidden />
          </button>
          <Link to={conversationId ? `/kia/${conversationId}` : "/kia"} onClick={() => assistantPanel.close()} className="rounded-md p-2 text-ink-muted hover:bg-sunken" aria-label="Ouvrir en pleine page" title="Ouvrir en pleine page">
            <Maximize2 className="h-5 w-5" aria-hidden />
          </Link>
        </>
      }
    >
      <ConversationView conversationId={conversationId} onConversationChange={change} prefill={prefill} />
    </Sheet>
  );
}
