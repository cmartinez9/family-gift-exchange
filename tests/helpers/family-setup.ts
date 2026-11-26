import {expect, type Page} from "@playwright/test";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

export async function openFamilyAfterDetails(page: Page, locale: "en" | "es" = "en") {
  const {draw} = locale === "en" ? en : es;
  await expect(page.getByRole("heading", {name: draw.setup.exchangeTitle})).toBeVisible();
  await page.getByRole("button", {name: draw.setup.nextPeople}).click();
  await expect(page.getByRole("heading", {name: draw.setup.peopleTitle})).toBeVisible();
  await page.goto(`/${locale}/family`);
  await expect(page.getByRole("heading", {name: draw.setup.housesTitle})).toBeVisible();
}
