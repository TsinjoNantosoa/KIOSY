import { screen } from "@testing-library/react";
import type { Message } from "@/contracts/models";
import { renderWithProviders } from "@/test/render";
import { MessageBlocks } from "./MessageBlocks";

describe("MessageBlocks", () => {
  it("affiche une ancienne citation sans date d'entrée en vigueur", () => {
    const legacyMessage = {
      id: "message-1",
      conversation_id: "conversation-1",
      role: "assistant",
      created_at: "2026-10-12T10:00:00Z",
      run_id: null,
      blocks: [
        {
          type: "citations",
          items: [
            {
              id: "vente:v1:achat",
              document_title: "Conditions générales de vente",
              section: "Achat",
              quote: "Une citation historique.",
              version: "v1",
              href: "/conditions/vente?version=v1#achat",
            },
          ],
        },
      ],
    } as unknown as Message;

    renderWithProviders(<MessageBlocks message={legacyMessage} onQuickReply={() => undefined} />);

    expect(screen.getByText("Version v1")).toBeInTheDocument();
    expect(screen.getByText("Une citation historique.", { exact: false })).toBeInTheDocument();
  });
});
