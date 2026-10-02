import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

test("recherche et filtres du catalogue conservés dans l'URL", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/catalogue");
  await expect(page.getByText("16 publications trouvées")).toBeVisible();
  await page.getByRole("radio", { name: /Business/ }).click();
  await expect(page).toHaveURL(/univers=business/);
  await expect(page.getByText("5 publications trouvées")).toBeVisible();
  await page.getByLabel("Rechercher").fill("export");
  await expect(page).toHaveURL(/q=export/);
  await expect(page.getByRole("heading", { name: "Lettre de l'export" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Rechercher")).toHaveValue("export");
  await expect(page.getByRole("radio", { name: /Business/ })).toBeChecked();
  await page.getByLabel("Rechercher").fill("agriculture");
  await expect(page.getByText("Aucune publication ne correspond")).toBeVisible();
  await page.goBack();
  expect(errors).toEqual([]);
});

test("ouverture d'un extrait sans exposer le fichier complet", async ({ page }) => {
  await page.goto("/publications/hebdo-ocean-indien");
  await page.getByRole("button", { name: "Lire l'extrait" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Dossier : la mer en partage")).toBeVisible();
  await expect(dialog.getByText(/Le fichier complet n'est pas exposé/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("ouverture directe d'une URL interne et page inconnue", async ({ page }) => {
  await page.goto("/conditions/vente#resiliation");
  await expect(page.getByRole("heading", { name: /Résiliation/ })).toBeVisible();
  await expect(page.getByText("Document provisoire")).toBeVisible();
  await page.goto("/cette-page-n-existe-pas");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});

test("offre indisponible signalée", async ({ page }) => {
  await page.goto("/publications/finance-au-quotidien");
  await expect(page.getByText("Édition indisponible")).toBeVisible();
  await expect(page.getByText(/Droits de diffusion expirés/).first()).toBeVisible();
});
