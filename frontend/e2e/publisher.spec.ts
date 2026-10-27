import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("publisher : brouillon, import, soumission et validation administrative", async ({ page }) => {
  const title = `Revue éditeur ${Date.now()}`;
  await loginAs(page, "editeur", "/publisher");
  await expect(page.getByRole("heading", { name: "Tableau de bord éditeur" })).toBeVisible();
  await page.getByRole("link", { name: "Publications" }).first().click();
  await page.getByRole("link", { name: "Nouvelle publication" }).click();
  await page.getByLabel("Titre").fill(title);
  await page.getByLabel("Auteur").fill("Auteur Phase 18");
  await page.getByLabel("Éditeur").selectOption({ index: 1 });
  await page.getByLabel("Résumé").fill("Publication créée par le workspace éditeur sécurisé.");
  await page.getByLabel("Libellé").fill("Édition RC");
  await page.getByRole("button", { name: "Créer en brouillon" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Importer le fichier" }).click();
  await page.getByLabel("Édition concernée").selectOption({ label: `${title} — Édition RC` });
  await page.getByLabel("Fichier").setInputFiles({ name: "phase18.txt", mimeType: "text/plain", buffer: Buffer.from("Contenu culturel Phase 18") });
  await page.getByRole("button", { name: "Envoyer en quarantaine" }).click();
  await expect(page.getByText("Prêt")).toBeVisible({ timeout: 15_000 });

  await page.goto("/publisher/publications");
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Soumettre à revue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("À revoir").first()).toBeVisible();

  await loginAs(page, "admin", "/admin/catalogue");
  await page.getByLabel("Statut").selectOption("review");
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await page.getByRole("button", { name: "Publier" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await page.goto(`/catalogue?q=${encodeURIComponent(title)}`);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
