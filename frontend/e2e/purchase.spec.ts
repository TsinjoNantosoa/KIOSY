import { expect, test } from "@playwright/test";
import { collectErrors, loginAs } from "./helpers";

test("achat de test : récapitulatif, paiement, vérification, accès en bibliothèque", async ({ page }) => {
  const errors = collectErrors(page);
  await loginAs(page, "hery");
  await page.goto("/publications/lettre-de-l-export");
  await page.getByRole("link", { name: "Choisir cette offre" }).first().click();
  await expect(page.getByRole("heading", { name: "Récapitulatif de commande" })).toBeVisible();
  await expect(page.getByText("Total à payer")).toBeVisible();
  await page.getByLabel(/J'ai lu les/).check();
  await page.getByRole("button", { name: /Confirmer la commande/ }).click();
  await expect(page).toHaveURL(/\/commande\/ord_/);
  await page.getByRole("button", { name: /^Payer/ }).click();
  await expect(page.getByRole("heading", { name: "Paiement de test" })).toBeVisible();
  await page.getByRole("button", { name: "Accepter le paiement", exact: true }).click();
  // Le paramètre de retour est ignoré : on attend le statut serveur.
  await expect(page).toHaveURL(/retour\?provider_status=success/);
  await expect(page.getByRole("heading", { name: "Vérification du paiement en cours" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Paiement confirmé, accès attribué" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Lire maintenant" }).click();
  await expect(page.getByRole("heading", { name: "Salons à venir" })).toBeVisible();
  await page.goto("/compte/bibliotheque");
  await expect(page.getByRole("heading", { name: "Lettre de l'export" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("avertissement pour un contenu déjà possédé", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/publications/trimestriel-de-l-entreprise");
  await expect(page.getByText("Vous avez déjà accès à cette édition")).toBeVisible();
  await expect(page.getByText("Vous disposez déjà de cet accès.").first()).toBeVisible();
  await page.goto("/commande?offre=off_e_e06a");
  await expect(page.getByText("Vous disposez déjà de cet accès")).toBeVisible();
  await expect(page.getByRole("button", { name: /Confirmer la commande/ })).toHaveCount(0);
});

test("paiement sans réponse : aucun faux succès, statut incertain", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAs(page, "hery");
  await page.goto("/commande?offre=off_e_e13a");
  await page.getByLabel(/J'ai lu les/).check();
  await page.getByRole("button", { name: /Confirmer la commande/ }).click();
  await page.getByRole("button", { name: /^Payer/ }).click();
  await page.getByRole("button", { name: "Ne jamais répondre" }).click();
  await expect(page.getByRole("heading", { name: "Statut du paiement encore inconnu" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Ne relancez pas de paiement")).toBeVisible();
  await expect(page.getByText("Paiement confirmé")).toHaveCount(0);
});

test("paiement refusé puis nouvelle tentative possible", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/commande?offre=off_e_e14a");
  await page.getByLabel(/J'ai lu les/).check();
  await page.getByRole("button", { name: /Confirmer la commande/ }).click();
  await page.getByRole("button", { name: /^Payer/ }).click();
  await page.getByRole("button", { name: "Refuser le paiement" }).click();
  await expect(page.getByText("Paiement refusé").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Réessayer le paiement/ })).toBeVisible();
});

test("résiliation avec conséquences visibles", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/compte/abonnements/sub_hery_culture");
  await page.getByRole("button", { name: "Préparer la résiliation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Votre accès reste ouvert jusqu'au/)).toBeVisible();
  await expect(dialog.getByText("Votre historique de commandes est conservé.")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmer" }).click();
  await expect(dialog.getByText(/Résiliation enregistrée/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Résilié à échéance").first()).toBeVisible();
});

test("déconnexion : données privées retirées et espace protégé", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/compte/bibliotheque");
  await expect(page.getByRole("heading", { name: "Le Trimestriel de l'Entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/compte/bibliotheque");
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByText("Le Trimestriel de l'Entreprise")).toHaveCount(0);
});
