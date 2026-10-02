import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, who: "hery" | "fara" | "support" | "responsable" | "admin", returnTo = "/compte") {
  // Repart d'une session vierge (changement de persona dans un même test).
  await page.goto("/aide");
  await page.evaluate(() => sessionStorage.removeItem("kiosy-demo-session"));
  await page.goto(`/connexion?retour=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Adresse e-mail").fill(`${who}@demo.kiosy.invalid`);
  await page.getByLabel("Mot de passe").fill("demo");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
