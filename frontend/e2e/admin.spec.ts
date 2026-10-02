import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("administration d'une édition : transitions contrôlées et motif de retrait", async ({ page }) => {
  await loginAs(page, "admin", "/admin");
  await page.goto("/admin/catalogue");
  await page.getByLabel("Statut").selectOption("review");
  await page.getByRole("link", { name: "Chroniques urbaines" }).first().click();
  await expect(page.getByText("Aucun fichier traité")).toBeVisible();
  await page.getByRole("button", { name: "Publier" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByRole("dialog").getByText(/importez-le avant de publier/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/admin/catalogue/e13a");
  await page.getByRole("button", { name: "Suspendre (retrait)" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirmer" })).toBeDisabled();
  await dialog.getByLabel(/Motif/).fill("Demande de retrait de l'éditeur (test)");
  await dialog.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("Suspendu").first()).toBeVisible();
  await page.goto("/catalogue?q=cinema");
  await expect(page.getByText("Aucune publication ne correspond")).toBeVisible();
});

test("séparation demandeur / approbateur", async ({ page }) => {
  await loginAs(page, "support", "/admin");
  await page.goto("/admin/approbations");
  await expect(page.getByText("En attente d'un responsable.")).toBeVisible();
  await page.goto("/admin/runs");
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();

  await loginAs(page, "responsable", "/admin");
  await page.goto("/admin/approbations");
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.getByRole("dialog").getByLabel(/Motif/).fill("Diagnostic en cours, accès temporaire justifié.");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("Approuvée")).toBeVisible();
});

test("import : validation locale indicative et suivi serveur repris après rafraîchissement", async ({ page }) => {
  await loginAs(page, "admin", "/admin");
  await page.goto("/admin/imports");
  await page.getByLabel("Édition concernée").selectOption("e05b");
  await page.getByLabel("Fichier").setInputFiles({ name: "chroniques.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expect(page.getByText("Signature PDF (%PDF-) présente")).toBeVisible();
  await page.getByRole("button", { name: "Envoyer en quarantaine" }).click();
  const row = () => page.locator("table").getByRole("row", { name: /chroniques\.pdf/ });
  await expect(row()).toBeVisible();
  await page.reload();
  await expect(row()).toBeVisible();
  await expect(row().getByText("Prêt")).toBeVisible({ timeout: 15_000 });
});

test("diagnostic IA sans métriques présentées comme mesurées", async ({ page }) => {
  await loginAs(page, "admin", "/admin");
  await page.goto("/admin/runs/run_seed_1");
  await expect(page.getByText("Non mesuré — simulation, aucun appel facturable")).toBeVisible();
  await expect(page.locator("table").getByText("search_publications")).toBeVisible();
});
