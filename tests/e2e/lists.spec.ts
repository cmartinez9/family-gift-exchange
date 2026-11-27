import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {devices, expect, test, type Page, type Request} from "@playwright/test";
import {eq} from "drizzle-orm";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, items} from "../../src/server/db/schema";
import {openKey, skipFaceId} from "../helpers/pin-pad";
import {openFamilyAfterDetails} from "../helpers/family-setup";

const pin = "4268";

async function startFamily(page: Page, language: "en" | "es") {
  const {auth, getIn} = language === "en" ? en : es;
  const familyName = `Spruce ${randomUUID().slice(0, 6)}`;
  await page.goto(`/${language}/start`);
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(familyName);
  await page.getByLabel(auth.yourName).fill("Frostleaf");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await expect(page.getByRole("heading", {name: getIn.face.title})).toBeVisible();
  await page.getByRole("link", {name: auth.notNow}).click();
  await openFamilyAfterDetails(page, language);
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
  const {lists, ui} = language === "en" ? en : es;
  await page.goto(`/${language}`);
  await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.list}).click();
  await expect(page.getByRole("heading", {name: lists.myList})).toBeVisible();
}

/** Takes an item off from its edit sheet, then waits out the Undo until the removal is saved. */
async function takeOff(page: Page, title: string, language: "en" | "es" = "en") {
  const {lists} = language === "en" ? en : es;
  await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", title)}).click();
  const removal = page.waitForResponse((response) => response.request().method() === "POST", {timeout: 15_000});
  await page.getByRole("dialog", {name: lists.editItem}).getByRole("button", {name: lists.deleteItem}).click();
  await expect(page.getByRole("article", {name: title})).toHaveCount(0);
  await expect(page.getByRole("status").filter({hasText: lists.tookOff.replace("{title}", title)})).toBeVisible();
  expect((await removal).ok()).toBe(true);
}

test("saves a removal when reloading before Undo expires", async ({page}) => {
  const {lists} = en;
  const familyId = await startFamily(page, "en");
  const connection = connectDatabase(process.env.DATABASE_URL!);
  try {
    await enterWishlists(page, "en");
    await page.getByRole("link", {name: lists.newNote}).click();
    await page.getByLabel(lists.title).fill("Reload gift");
    await page.getByRole("button", {name: lists.saveItem}).click();
    const card = page.getByRole("article", {name: "Reload gift", exact: true});
    await expect(card).toBeVisible();
    await card.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Reload gift")}).click();
    await page.getByRole("dialog", {name: lists.editItem}).getByRole("button", {name: lists.deleteItem}).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("button", {name: en.ui.undo, exact: true})).toBeVisible();
    await page.reload();
    await expect.poll(() => runForFamily(connection.db, familyId, async (tx) => {
      const [removed] = await tx.select({archivedAt: items.archivedAt}).from(items).where(eq(items.familyId, familyId));
      return removed?.archivedAt !== null && removed?.archivedAt !== undefined;
    })).toBe(true);
    await page.reload();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("heading", {name: lists.emptyTitle})).toBeVisible();
  } finally {
    await connection.close();
    await removeFamily(familyId);
  }
});

for (const language of ["en", "es"] as const) {
  test(`adds, edits and removes an item and saves sizes as you go in ${language}`, async ({page}) => {
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
      await expect(page.getByRole("status").filter({hasText: lists.added})).toBeVisible();

      const card = page.getByRole("article", {name: "Winter puzzle"});
      await expect(card.getByText("Any pattern")).toBeVisible();
      await expect(card.getByRole("button", {name: lists.star})).toHaveAttribute("aria-pressed", "true");
      await card.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Winter puzzle")}).click();
      const sheet = page.getByRole("dialog", {name: lists.editItem});
      await sheet.getByRole("textbox", {name: lists.note, exact: true}).fill("500 pieces preferred");
      await sheet.getByRole("button", {name: lists.saveItem}).click();
      await expect(sheet).toBeHidden();
      await expect(card.getByText("500 pieces preferred")).toBeVisible();
      // the heart saves on its own
      const starSave = page.waitForResponse((response) => response.request().method() === "POST");
      await card.getByRole("button", {name: lists.star}).click();
      await expect(card.getByRole("button", {name: lists.star})).toHaveAttribute("aria-pressed", "false");
      expect((await starSave).ok()).toBe(true);
      await page.reload();
      await expect(card.getByRole("button", {name: lists.star})).toHaveAttribute("aria-pressed", "false");

      await page.getByRole("link", {name: new RegExp(lists.mySizes)}).click();
      const saved = page.getByRole("status").filter({hasText: lists.saved});
      const save = () => page.waitForResponse((response) => response.request().method() === "POST");
      let saving = save();
      await page.getByRole("group", {name: lists.size.tops}).getByText("M", {exact: true}).click();
      expect((await saving).ok()).toBe(true);
      await expect(saved).toBeVisible();
      saving = save();
      await page.getByLabel(lists.size.shoeSystem).selectOption("eu");
      expect((await saving).ok()).toBe(true);
      await expect(page.getByRole("button", {name: lists.shoeBigger})).toBeVisible();
      const shoeSize = page.getByLabel(lists.size.shoes, {exact: true});
      const profileSaves: Request[] = [];
      const recordSave = (request: Request) => {
        if (request.method() === "POST") profileSaves.push(request);
      };
      page.on("request", recordSave);
      await shoeSize.pressSequentially("39");
      await expect(shoeSize).toHaveValue("39");
      expect(profileSaves).toHaveLength(0);
      saving = save();
      await shoeSize.blur();
      expect((await saving).ok()).toBe(true);
      expect(profileSaves).toHaveLength(1);
      page.off("request", recordSave);
      const color = page.getByLabel(lists.aboutField.colors);
      await color.fill("Verde");
      saving = save();
      await color.blur();
      expect((await saving).ok()).toBe(true);
      await page.reload();
      await expect(page.getByLabel(lists.aboutField.colors)).toHaveValue("Verde");
      await expect(page.getByRole("group", {name: lists.size.tops}).getByRole("radio", {name: "M"})).toBeChecked();
      await page.getByRole("link", {name: lists.myList}).click();
      await expect(page.getByRole("link", {name: new RegExp(lists.mySizes)})).toContainText("39");
      await page.screenshot({path: test.info().outputPath(`wishlist-and-sizes-${language}.png`), fullPage: true});

      await page.getByRole("link", {name: new RegExp(lists.mySizes)}).click();
      saving = save();
      await page.getByRole("switch", {name: lists.noClothes}).click();
      expect((await saving).ok()).toBe(true);
      await page.getByRole("link", {name: lists.myList}).click();
      await expect(page.getByRole("link", {name: new RegExp(lists.mySizes)})).toContainText(lists.noClothes);

      await expect(page).toHaveTitle(/\S/);
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      await takeOff(page, "Winter puzzle", language);
      await page.reload();
      await expect(page.getByRole("heading", {name: lists.emptyTitle})).toBeVisible();
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
    await openKey(memberPage, url, pin);
    await skipFaceId(memberPage);

    await page.goto("/en/lists");
    await page.getByLabel(en.lists.budget, {exact: true}).fill("45");
    await page.getByRole("button", {name: en.lists.saveBudget}).click();
    await expect(page.getByText("Gift budget: $45.00")).toBeVisible();
    await page.getByRole("navigation", {name: en.ui.tabs.label}).getByRole("link", {name: en.ui.tabs.list}).click();
    await page.getByRole("link", {name: en.lists.newLink}).click();
    const productLink = page.getByLabel(en.lists.url);
    await productLink.fill("javascript:alert(1)");
    await page.getByRole("button", {name: en.lists.preview, exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: en.lists.feedback["unsafe-link"]})).toBeVisible();
    await productLink.fill("shop.example.com/bright-lantern?utm_source=fixture");
    await page.getByRole("button", {name: en.lists.preview, exact: true}).click();
    const preview = page.getByRole("region", {name: en.lists.previewTitle});
    await expect(preview.getByText(en.lists.noPicture.replace("{store}", "shop.example.com"))).toBeVisible();
    await expect(preview.getByRole("link", {name: en.lists.openProduct})).toHaveAttribute(
      "href", "https://shop.example.com/bright-lantern",
    );
    await page.screenshot({path: test.info().outputPath("link-fallback.png"), fullPage: true});

    const image = await sharp({create: {width: 80, height: 80, channels: 3, background: "#b7ded2"}}).png().toBuffer();
    await page.getByLabel(en.lists.photo, {exact: true}).setInputFiles({name: "fixture.png", mimeType: "image/png", buffer: image});
    await expect(page.getByLabel(en.lists.replacePhoto)).toBeAttached();
    await page.getByLabel(en.lists.title).fill("Bright lantern");
    await page.getByRole("button", {name: en.lists.saveItem}).click();
    const ownerCard = page.getByRole("article", {name: "Bright lantern"});
    const photo = ownerCard.locator("img");
    const photoUrl = (await photo.getAttribute("src"))!;
    const photoResponse = await page.request.get(photoUrl);
    expect(photoResponse.ok()).toBe(true);
    expect(photoResponse.headers()["content-type"]).toBe("image/webp");
    const anonymous = await browser.newContext({...device, ignoreHTTPSErrors: true});
    try {
      const denied = await anonymous.request.get(new URL(photoUrl, page.url()).href, {maxRedirects: 0});
      expect(denied.status()).toBe(307);
      expect(denied.headers()["content-type"]).not.toBe("image/webp");
      await test.info().attach("photo-access", {
        body: JSON.stringify({memberStatus: photoResponse.status(), memberType: photoResponse.headers()["content-type"],
          anonymousStatus: denied.status(), anonymousRedirect: denied.headers().location}, null, 2),
        contentType: "application/json",
      });
    } finally {
      await anonymous.close();
    }

    await memberPage.goto("/en/lists");
    await memberPage.getByRole("link", {name: /^Frostleaf/}).click();
    const memberCard = memberPage.getByRole("article", {name: "Bright lantern"});
    await memberCard.getByRole("button", {name: en.lists.claim}).click();
    await expect(memberCard.getByText(en.lists.mine)).toBeVisible();
    await expect(memberCard).toHaveAttribute("aria-busy", "false");
    await memberPage.screenshot({path: test.info().outputPath("photo-and-claim-member.png"), fullPage: true});
    await page.reload();
    await expect(ownerCard.getByText(en.lists.mine)).toHaveCount(0);
    await expect(ownerCard.getByText(en.lists.someone)).toHaveCount(0);
    await expect(ownerCard.getByRole("button", {name: en.lists.claim})).toHaveCount(0);
    await page.screenshot({path: test.info().outputPath("photo-owner-private.png"), fullPage: true});

    await memberPage.goto("/en");
    await memberPage.getByRole("link", {name: new RegExp(en.lists.getting)}).click();
    await memberPage.getByLabel(en.lists.bought).check();
    await expect(memberPage.getByLabel(en.lists.bought)).toBeEnabled();
    await memberPage.getByLabel(en.lists.wrapped).check();
    await expect(memberPage.getByLabel(en.lists.wrapped)).toBeEnabled();
    await memberPage.reload();
    await expect(memberPage.getByLabel(en.lists.bought)).toBeChecked();
    await expect(memberPage.getByLabel(en.lists.wrapped)).toBeChecked();
    await memberPage.screenshot({path: test.info().outputPath("purchase-checklist.png"), fullPage: true});

    await takeOff(page, "Bright lantern");
    await memberPage.reload();
    await expect(memberPage.getByText(en.lists.emptyGetting)).toBeVisible();
    const missingList = new URL(`/en/lists/${randomUUID()}`, memberPage.url());
    expect((await memberPage.request.get(missingList.href)).status()).toBe(404);
  } finally {
    await member.close();
    await removeFamily(familyId);
  }
});
