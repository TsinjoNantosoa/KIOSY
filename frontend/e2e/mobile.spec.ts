import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, loginAs } from "./helpers";

test("mobile 360 px : catalogue, filtres, fiche, commande, bibliothèque, KIA", async ({ page }) => {
  await page.goto("/");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Catalogue" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/catalogue");
  await page.getByRole("button", { name: /Filtres/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /Culture/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Voir/ }).click();
  await expect(page).toHaveURL(/univers=culture/);
  await expectNoHorizontalOverflow(page);

  await loginAs(page, "fara", "/offres");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("radio", { name: /Sélectionner Abonnement Culture — mensuel|Abonnement Culture — mensuel/ }).first().check();
  await page.getByRole("button", { name: "Continuer avec cette offre" }).click();
  await expect(page.getByRole("button", { name: /Confirmer la commande/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/compte/bibliotheque");
  await expect(page.getByRole("link", { name: /^Lire/ }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: /^Lire/ }).first().click();
  await expect(page.getByRole("button", { name: "Agrandir le texte" }).or(page.getByRole("link", { name: "Ouvrir le PDF" }))).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/compte");
  await page.getByRole("button", { name: /^KIA/ }).click();
  const panel = page.getByRole("dialog");
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(355); // plein écran
  await panel.getByRole("button", { name: "Compare les abonnements" }).click();
  await expect(panel.getByText("Comparaison des offres (prix serveur)")).toBeVisible({ timeout: 10_000 });
});

test("clavier : focus visible et navigation sans souris", async ({ page }) => {
  await page.goto("/catalogue");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Aller au contenu principal" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? getComputedStyle(el).outlineStyle : "none";
  });
  expect(focused).not.toBe("none");
});
