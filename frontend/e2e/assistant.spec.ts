import { expect, test } from "@playwright/test";
import { collectErrors, loginAs } from "./helpers";

test("KIA : demande composée, plusieurs spécialistes, action à confirmer", async ({ page }) => {
  const errors = collectErrors(page);
  await loginAs(page, "hery");
  await page.goto("/kia");
  await page.getByLabel("Message pour KIA").fill("Je veux une offre business et agriculture sans repayer mes accès");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Recherche de contenus")).toBeVisible();
  await expect(page.getByText(/ne contient aucune publication consacrée à l'agriculture/)).toBeVisible({ timeout: 15_000 });
  const proposal = page.getByRole("region", { name: /Proposition/ });
  await expect(proposal.getByText("Action préparée · Attente de validation")).toBeVisible();
  await proposal.getByRole("button", { name: "Confirmer" }).click();
  await expect(proposal.getByText(/Aucun paiement n'a été effectué/)).toBeVisible();
  await expect(proposal.getByRole("link", { name: "Procéder au paiement de test" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("KIA : une proposition expirée est refusée (409) et doit être refaite", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/kia");
  await page.getByLabel("Message pour KIA").fill("Test proposition expirée business");
  await page.keyboard.press("Enter");
  const proposal = page.getByRole("region", { name: /Proposition/ });
  await expect(proposal).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(9_000);
  await proposal.getByRole("button", { name: "Confirmer" }).click();
  await expect(proposal.getByText("Cette proposition n'est plus valable")).toBeVisible();
  await expect(proposal.getByRole("link", { name: /Revoir l'offre/ })).toBeVisible();
});

test("KIA : reprise du suivi après rechargement pendant un traitement", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/kia");
  await page.getByLabel("Message pour KIA").fill("Je veux m'abonner à la presse");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kia\/conv_/);
  await expect(page.getByText("KIA travaille…")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /Proposition/ })).toBeVisible({ timeout: 15_000 });
});

test("KIA : outil indisponible, pas de réponse inventée", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/kia");
  await page.getByLabel("Message pour KIA").fill("Test outil en panne");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/je ne fais aucune supposition/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Ouvrir une demande d'assistance" })).toBeVisible();
});

test("KIA : un visiteur est invité à se connecter pour une demande personnelle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^KIA/ }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Message pour KIA").fill("Pourquoi je n'ai plus accès à mon abonnement ?");
  await panel.getByLabel("Message pour KIA").press("Enter");
  await expect(panel.getByRole("link", { name: "Se connecter" })).toBeVisible({ timeout: 10_000 });
});

test("problème d'accès : KIA diagnostique et propose une demande d'assistance", async ({ page }) => {
  await loginAs(page, "hery");
  await page.goto("/kia");
  await page.getByLabel("Message pour KIA").fill("Je n'arrive pas à ouvrir L'Écho du Matin");
  await page.keyboard.press("Enter");
  const proposal = page.getByRole("region", { name: /Proposition/ });
  await expect(page.getByText(/a expiré le/)).toBeVisible({ timeout: 15_000 });
  await proposal.getByRole("button", { name: "Confirmer" }).click();
  await proposal.getByRole("link", { name: "Suivre la demande" }).click();
  await expect(page.getByRole("heading", { name: /Accès à L'Écho du Matin/ })).toBeVisible();
});
