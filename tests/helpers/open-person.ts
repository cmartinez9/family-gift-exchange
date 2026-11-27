import {expect, type Page} from "@playwright/test";

export async function openPerson(page: Page) {
  const heading = page.getByRole("heading", {level: 1, name: /^(You’re giving to|Le regalas a) /});
  const opener = page.getByRole("button", {name: /^(Open your person|Or tap here to open it|Descubrir a tu persona|O toca aquí para abrirlo)$/});
  await expect(opener).toBeVisible();
  const firstReveal = await page.getByRole("button", {name: /^(Or tap here to open it|O toca aquí para abrirlo)$/}).isVisible();
  await opener.click();
  if (firstReveal) {
    const see = page.getByRole("button", {name: /^(See .+’s page|Ver la página de .+)$/});
    await expect(see).toBeVisible({timeout: 10_000});
    await see.click();
  }
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.replace(/^(You’re giving to|Le regalas a)/, "").trim();
}
