import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {devices, expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";

const pin = "4268";

async function startFamily(page: Page, language: "en" | "es") {
  const {auth} = language === "en" ? en : es;
  const familyName = `Spruce ${randomUUID().slice(0, 6)}`;
  await page.goto(`/${language}/start`);
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(familyName);
  await page.getByLabel(auth.yourName).fill("Frostleaf");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("heading", {name: familyName})).toBeVisible();
  const session = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session");
  return session!.value.split(".")[0];
}

async function removeFamily(familyId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for wishlist browser tests");
  const {db, close} = connectDatabase(databaseUrl);
  try {
    await runForFamily(db, familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  } finally {
    await close();
  }
}

async function enterWishlists(page: Page, language: "en" | "es") {
  const {lists} = language === "en" ? en : es;
  await page.getByRole("link", {name: lists.familyLists}).click();
  await page.getByRole("link", {name: lists.myList}).click();
  await expect(page.getByRole("heading", {name: lists.myList})).toBeVisible();
}

for (const language of ["en", "es"] as const) {
  test(`adds, edits and removes an item and saves sizes on blur in ${language}`, async ({page}) => {
    const {lists} = language === "en" ? en : es;
    const familyId = await startFamily(page, language);
    try {
      await enterWishlists(page, language);
      await page.getByRole("link", {name: lists.newNote}).click();
      await page.getByLabel(lists.title).fill("Winter puzzle");
      await page.getByRole("textbox", {name: lists.note, exact: true}).fill("Any pattern");
      await page.getByLabel(lists.price).fill("12,50");
      await page.getByLabel(lists.star, {exact: true}).check();
      await page.getByRole("button", {name: lists.saveItem}).click();

      const card = page.getByRole("article", {name: "Winter puzzle"});
      await expect(card.getByText("Any pattern")).toBeVisible();
      await expect(card.getByText(lists.starred)).toBeVisible();
      await card.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Winter puzzle")}).click();
      await page.getByRole("textbox", {name: lists.note, exact: true}).fill("500 pieces preferred");
      await page.getByRole("button", {name: lists.saveItem}).click();
      await expect(card.getByText("500 pieces preferred")).toBeVisible();

      await page.getByRole("link", {name: lists.editProfile}).click();
      const tops = page.getByLabel(lists.size.tops);
      await tops.fill("M");
      await expect(page.getByRole("status")).toHaveText("");
      await tops.blur();
      await expect(page.getByRole("status")).toHaveText(lists.saved);
      const shoeSystem = page.getByLabel(lists.size.shoeSystem);
      await shoeSystem.selectOption("eu");
      await shoeSystem.blur();
      const shoeSize = page.getByLabel(lists.size.shoes, {exact: true});
      await shoeSize.fill("39");
      await shoeSize.blur();
      const color = page.getByLabel(lists.aboutField.colors);
      await color.fill("Verde");
      await color.blur();
      await expect(page.getByRole("status")).toHaveText(lists.saved);
      await page.getByRole("link", {name: lists.backToList}).click();
      await expect(page.getByRole("region", {name: lists.sizes}).getByText("39", {exact: true})).toBeVisible();
      await expect(page.getByRole("region", {name: lists.about}).getByText("Verde", {exact: true})).toBeVisible();

      await page.getByRole("link", {name: lists.editProfile}).click();
      await page.getByLabel(lists.noClothes).check();
      await expect(page.getByRole("status")).toHaveText(lists.saved);
      await page.getByRole("link", {name: lists.backToList}).click();
      await expect(page.getByText(lists.noClothes)).toBeVisible();
      await expect(page.getByText("39", {exact: true})).toHaveCount(0);

      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      await card.getByText(lists.deleteItem, {exact: true}).click();
      await card.getByRole("button", {name: lists.confirmDeleteButton}).click();
      await expect(card).toHaveCount(0);
      await expect(page.getByText(lists.noItemsOwn)).toBeVisible();
    } finally {
      await removeFamily(familyId);
    }
  });
}

test("shows a link fallback, saves a private photo, and keeps claim marks and ticks away from the owner", async ({page, browser, browserName}) => {
  const familyId = await startFamily(page, "en");
  const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
  const member = await browser.newContext({...device, ignoreHTTPSErrors: true});
  try {
    await page.locator("summary").filter({hasText: /^Add a person$/}).click();
    await page.getByRole("textbox", {name: en.auth.name}).fill("Snowfinch");
    await page.getByRole("button", {name: en.auth.addMember}).click();
    await expect(page.getByRole("heading", {name: "Snowfinch"})).toBeVisible();
    await page.getByRole("link", {name: en.auth.sendKeys}).click();
    await page.getByRole("button", {name: en.auth.prepareKey}).click();
    const keyMessage = page.getByText("Hi Snowfinch! This is your private key", {exact: false});
    const url = (await keyMessage.innerText()).split(" ").at(-1)!;

    const memberPage = await member.newPage();
    await memberPage.goto(url);
    await memberPage.getByRole("button", {name: "Yes, I'm Snowfinch"}).click();
    await memberPage.getByLabel(en.auth.pin, {exact: true}).fill(pin);
    await memberPage.getByLabel(en.auth.confirmPin).fill(pin);
    await memberPage.getByRole("button", {name: en.auth.savePin}).click();
    await memberPage.getByRole("link", {name: en.auth.notNow}).click();

    await page.goto("/en/lists");
    await page.getByText(en.lists.budget, {exact: true}).first().click();
    await page.getByLabel(en.lists.budget, {exact: true}).fill("45");
    await page.getByRole("button", {name: en.lists.saveBudget}).click();
    await expect(page.getByText("Gift budget: $45.00")).toBeVisible();
    await page.getByRole("link", {name: en.lists.myList}).click();
    await page.getByRole("link", {name: en.lists.newLink}).click();
    const productLink = page.getByLabel(en.lists.url);
    await productLink.fill("javascript:alert(1)");
    await productLink.blur();
    await expect(page.getByRole("alert").filter({hasText: en.lists.feedback["unsafe-link"]})).toBeVisible();
    await productLink.fill("shop.example.com/bright-lantern?utm_source=fixture");
    await productLink.blur();
    const preview = page.getByRole("region", {name: en.lists.previewTitle});
    await expect(preview.getByText(en.lists.photoFallback)).toBeVisible();
    await expect(preview.getByRole("link", {name: en.lists.openProduct})).toHaveAttribute(
      "href", "https://shop.example.com/bright-lantern",
    );

    const image = await sharp({create: {width: 80, height: 80, channels: 3, background: "#b7ded2"}}).png().toBuffer();
    await page.getByLabel(en.lists.photo, {exact: true}).setInputFiles({name: "fixture.png", mimeType: "image/png", buffer: image});
    await expect(page.getByLabel(en.lists.replacePhoto)).toBeVisible();
    await page.getByLabel(en.lists.title).fill("Bright lantern");
    await page.getByRole("button", {name: en.lists.saveItem}).click();
    const ownerCard = page.getByRole("article", {name: "Bright lantern"});
    const photo = ownerCard.locator("img");
    const photoUrl = (await photo.getAttribute("src"))!;
    const photoResponse = await page.request.get(photoUrl);
    expect(photoResponse.ok()).toBe(true);
    expect(photoResponse.headers()["content-type"]).toBe("image/webp");

    await memberPage.getByRole("link", {name: en.lists.familyLists}).click();
    await memberPage.getByRole("link", {name: "Frostleaf"}).click();
    const memberCard = memberPage.getByRole("article", {name: "Bright lantern"});
    await memberCard.getByRole("button", {name: en.lists.claim}).click();
    await expect(memberCard.getByText(en.lists.mine)).toBeVisible();
    await page.reload();
    await expect(ownerCard.getByText(en.lists.mine)).toHaveCount(0);
    await expect(ownerCard.getByText(en.lists.someone)).toHaveCount(0);
    await expect(ownerCard.getByRole("button", {name: en.lists.claim})).toHaveCount(0);

    await memberPage.getByRole("link", {name: en.lists.getting}).click();
    await memberPage.getByLabel(en.lists.bought).check();
    await memberPage.getByLabel(en.lists.wrapped).check();
    await expect(memberPage.getByLabel(en.lists.wrapped)).toBeEnabled();
    await memberPage.reload();
    await expect(memberPage.getByLabel(en.lists.bought)).toBeChecked();
    await expect(memberPage.getByLabel(en.lists.wrapped)).toBeChecked();

    await ownerCard.getByText(en.lists.deleteItem, {exact: true}).click();
    await ownerCard.getByRole("button", {name: en.lists.confirmDeleteButton}).click();
    await expect(ownerCard).toHaveCount(0);
    await memberPage.reload();
    await expect(memberPage.getByText(en.lists.emptyGetting)).toBeVisible();
    const missingList = new URL(`/en/lists/${randomUUID()}`, memberPage.url());
    expect((await memberPage.request.get(missingList.href)).status()).toBe(404);
  } finally {
    await member.close();
    await removeFamily(familyId);
  }
});
