import {expect, type Page} from "@playwright/test";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

export async function openFamilyAfterDetails(page: Page, locale: "en" | "es" = "en") {
  const {draw} = locale === "en" ? en : es;
  // after creating a family, people and houses leads with the exchange's first step
  const start = page.getByRole("link", {name: draw.setup.startExchange});
  const title = page.getByRole("heading", {name: draw.setup.exchangeTitle});
  await expect(start.or(title)).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(title).toBeVisible();
  await page.getByRole("button", {name: draw.setup.nextPeople}).click();
  await expect(page.getByRole("heading", {name: draw.setup.peopleTitle})).toBeVisible();
  await page.goto(`/${locale}/family`);
  await expect(page.getByRole("heading", {name: draw.setup.housesTitle})).toBeVisible();
}
