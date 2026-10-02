import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssetAccess } from "@/contracts/models";
import { api } from "@/services/api";
import { renderWithProviders } from "@/test/render";
import ReaderPage from "./ReaderPage";

const access = (overrides: Partial<AssetAccess> = {}): AssetAccess => ({
  asset_id: "asset-1", edition_id: "edition-1", title: "Titre", edition_label: "N° 1", publication_slug: "titre",
  format: "pdf", media_type: "application/pdf", url: "blob:https://example.test/id",
  expires_at: new Date(Date.now() + 60_000).toISOString(), download_allowed: true, ...overrides,
});

describe("ReaderPage", () => {
  it("refuse un téléchargement dont la permission vient d'être retirée", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const spy = vi.spyOn(api.me, "assetAccess").mockResolvedValue(access());
    renderWithProviders(<ReaderPage />, { route: "/lire/edition-1", path: "/lire/:editionId" });
    const button = await screen.findByRole("button", { name: /Télécharger/ });
    spy.mockResolvedValue(access({ download_allowed: false }));
    await userEvent.click(button);
    expect(await screen.findByText(/n'est plus autorisé/)).toBeInTheDocument();
  });

  it("refuse un nouveau lien déjà expiré", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const spy = vi.spyOn(api.me, "assetAccess").mockResolvedValue(access());
    renderWithProviders(<ReaderPage />, { route: "/lire/edition-1", path: "/lire/:editionId" });
    const button = await screen.findByRole("button", { name: /Télécharger/ });
    spy.mockResolvedValue(access({ expires_at: new Date(Date.now() - 1_000).toISOString() }));
    await userEvent.click(button);
    expect(await screen.findByText(/a déjà expiré/)).toBeInTheDocument();
  });
});
