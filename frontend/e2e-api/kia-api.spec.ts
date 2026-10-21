import { expect, type Page, test } from "@playwright/test";

const password = "Kiosy-E2E-Password-2026!";

async function registerFresh(page: Page, prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom affiché").fill(`Lecteur ${prefix}`);
  await page.getByLabel("Adresse e-mail").fill(`${prefix}-${suffix}@example.com`);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(password);
  await passwordFields.nth(1).fill(password);
  await page.getByLabel(/Je confirme être majeur/).check();
  await page.getByLabel(/J'accepte les conditions/).check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).not.toHaveURL(/\/inscription/);
}

async function sendAndWait(page: Page, message: string) {
  const completed = page.getByText("Cette réponse vous aide ?");
  const before = await completed.count();
  await page.getByLabel("Message pour KIA").fill(message);
  await page.getByLabel("Message pour KIA").press("Enter");
  await expect(completed).toHaveCount(before + 1, { timeout: 90_000 });
}

async function payCurrentOrder(page: Page) {
  await page.getByRole("button", { name: /^Payer/ }).click();
  await expect(page).toHaveURL(/\/v1\/test-payments\//);
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await expect(page).toHaveURL(/\/commande\/[^/]+\/retour/);
  await expect(page.getByRole("heading", { name: "Paiement confirmé, accès attribué" })).toBeVisible();
}

test("KIA compare, vérifie les accès et conditions, puis prépare un achat confirmé", async ({ page }) => {
  await registerFresh(page, "kia-purchase");
  await page.goto("/kia");

  await sendAndWait(
    page,
    "Je cherche une publication pour développer mon activité à l’international. Vérifie ce que je possède déjà afin d’éviter un achat inutile et vérifie aussi les conditions.",
  );
  await expect(page.getByText("Comparaison des offres (prix serveur)")).toBeVisible();
  await expect(page.getByText("Sources")).toBeVisible();

  await sendAndWait(page, "Je veux souscrire.");
  const proposal = page.getByRole("region", { name: /Proposition/ }).last();
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Confirmer" }).click();
  const paymentLink = proposal.getByRole("link", { name: "Continuer vers le paiement" });
  await expect(paymentLink).toBeVisible();
  await paymentLink.click();
  await payCurrentOrder(page);
  await page.getByRole("link", { name: /Ouvrir ma bibliothèque|Lire maintenant/ }).click();
  await expect(page.getByRole("heading", { name: /Ma bibliothèque|Lecture/ })).toBeVisible();
});

test("KIA diagnostique un problème d'accès et ouvre une demande d'assistance", async ({ page }) => {
  await registerFresh(page, "kia-support");
  await page.goto("/kia");

  await sendAndWait(page, "Je possède cette publication mais je n’arrive pas à l’ouvrir.");
  await expect(page.getByRole("link", { name: "Ouvrir une demande d'assistance" })).toBeVisible();

  await sendAndWait(page, "Ouvre un ticket.");
  await expect(page.getByRole("link", { name: "Suivre la demande" })).toBeVisible();
});

test("KIA prépare une résiliation et ne l'exécute qu'après confirmation", async ({ page }) => {
  await registerFresh(page, "kia-cancel");
  await page.goto("/offres");
  await page.getByRole("radio", { name: /Sélectionner Abonnement business/i }).first().check();
  await page.getByRole("button", { name: "Continuer avec cette offre" }).click();
  await page.getByLabel(/J'ai lu les conditions de vente/).check();
  await page.getByRole("button", { name: /Confirmer la commande/ }).click();
  await payCurrentOrder(page);

  await page.goto("/kia");
  await sendAndWait(page, "Je souhaite arrêter mon abonnement.");
  const proposal = page.getByRole("region", { name: /Proposition/ }).last();
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Confirmer" }).click();
  await expect(proposal.getByText("Résiliation programmée à l'échéance.")).toBeVisible();
});
