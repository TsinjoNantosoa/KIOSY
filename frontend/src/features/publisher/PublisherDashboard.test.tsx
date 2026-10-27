import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminEditionRow, ImportJob } from "@/contracts/models";
import { renderWithProviders } from "@/test/render";
import PublisherDashboard from "./PublisherDashboard";

const rows: AdminEditionRow[] = [
  {
    publication: {
      id: "publication-a",
      slug: "publication-a",
      title: "Publication A",
      author: "Auteur",
      publisher: { id: "publisher-a", name: "Publisher A", is_demo: false },
      universe: "culture",
      language: "fr",
      summary: "Résumé",
      tags: [],
      cover: { palette: ["#000000", "#ffffff", "#226655"], motif: "grid", kicker: "Culture" },
      kind: "work",
      is_demo: false,
    },
    edition: {
      id: "edition-a",
      publication_id: "publication-a",
      label: "Édition A",
      published_at: "2026-10-27T00:00:00Z",
      format: "text",
      language: "fr",
      page_count: null,
      word_count: 100,
      status: "changes_requested",
      availability: { state: "unavailable", territories: [], rights_valid_until: null, reason: null },
      permissions: { public_excerpt: true, ai_indexing: true, full_text_public: false },
      is_free: false,
      version: 2,
      asset_id: "asset-a",
    },
  },
];

const imports: ImportJob[] = [{
  id: "import-a",
  file_name: "contenu.txt",
  size_bytes: 100,
  media_type: "text/plain",
  edition_id: "edition-a",
  edition_label: "Édition A",
  status: "failed",
  progress: 30,
  error: { code: "EXTRACTION_FAILED", message: "Extraction impossible" },
  warnings: [],
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
}];

const mocks = vi.hoisted(() => ({ editions: vi.fn(), imports: vi.fn(), analytics: vi.fn() }));

vi.mock("@/features/auth/session", () => ({ useUid: () => "publisher-user" }));
vi.mock("@/services/api", () => ({
  api: { admin: { editions: mocks.editions, imports: mocks.imports, publisherAnalytics: mocks.analytics } },
}));

describe("PublisherDashboard", () => {
  it("affiche uniquement les métriques réellement dérivées des contenus éditeur", async () => {
    mocks.editions.mockResolvedValue(rows);
    mocks.imports.mockResolvedValue(imports);
    mocks.analytics.mockResolvedValue({ publications: 1, editions: 1, orders: 0, entitlements: 0 });
    renderWithProviders(<PublisherDashboard />);
    expect(await screen.findByText("Tableau de bord éditeur")).toBeInTheDocument();
    expect(screen.getByText("Corrections demandées")).toBeInTheDocument();
    expect(screen.getByText(/1 import\(s\) nécessitent/)).toBeInTheDocument();
  });
});
