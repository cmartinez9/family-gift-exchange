import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "@playwright/test";

test("opens the exchange, switches language, and keeps the outbox private", async ({page, request}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", {name: "Family Gift Exchange"})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);

  await page.getByRole("link", {name: "Español"}).click();
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", {name: "Intercambio familiar de regalos"})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);

  const devMessages = await request.get("/dev/messages");
  expect(devMessages.status()).toBe(404);
});
