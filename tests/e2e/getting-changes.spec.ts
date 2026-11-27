import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type BrowserContextOptions, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {claims, families, items, people} from "../../src/server/db/schema";
import {openKey, skipFaceId} from "../helpers/pin-pad";

// 5.6 "Ana changed this": a gift you are getting whose owner edited it since you last looked. Shot at
// 390 by 844, in Spanish, with reduced motion and at the largest text size (the browser at 200%, so the
// phone lays out at 195 CSS pixels). E2E_EVIDENCE_DIR overrides test-results/design/.

const pin = "4268";
const phone = {viewport: {width: 390, height: 844}} satisfies BrowserContextOptions;
const largest = {viewport: {width: 195, height: 422}, deviceScaleFactor: 2} satisfies BrowserContextOptions;
const shots = process.env.E2E_EVIDENCE_DIR || "test-results/design";
const {lists} = en;
const changed = lists.changed;

async function withDatabase<T>(familyId: string, action: Parameters<typeof runForFamily<T>>[2]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for wishlist browser tests");
  const {db, close} = connectDatabase(databaseUrl);
  try {
    return await runForFamily(db, familyId, action);
  } finally {
    await close();
  }
}

async function startFamily(page: Page) {
  const {auth} = en;
  const familyName = `Tinsel ${randomUUID().slice(0, 6)}`;
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(familyName);
  await page.getByLabel(auth.yourName).fill("Rosa");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("heading", {name: familyName})).toBeVisible();
  const session = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session");
  return session!.value.split(".")[0];
}

/** Ana and her list. Rosa is already getting the book, and has bought it. */
async function seedAna(familyId: string) {
  return withDatabase(familyId, async (tx) => {
    const [rosa] = await tx.select({id: people.id}).from(people).where(eq(people.familyId, familyId));
    const [ana] = await tx.insert(people).values({familyId, displayName: "Ana"}).returning({id: people.id});
    const [socks, book] = await tx.insert(items).values([
      {familyId, ownerId: ana.id, kind: "note", title: "Cozy slipper socks", note: "Size 7 to 8", price: "12.97", position: 0},
      {familyId, ownerId: ana.id, kind: "note", title: "Sourdough baking book", price: "24.50", position: 1},
    ]).returning({id: items.id});
    await tx.insert(claims).values({
      familyId, itemId: book.id, claimerId: rosa.id, boughtAt: new Date(),
      seen: {title: "Sourdough baking book", note: null, url: null, store: null, price: "24.50"},
    });
    return {ana: ana.id, socks: socks.id};
  });
}

/** Ana edits her socks, as her edit form would save them. */
function anaEdits(familyId: string, itemId: string, values: {note?: string; price?: string}) {
  return withDatabase(familyId, (tx) => tx.update(items).set({...values, updatedAt: new Date()})
    .where(and(eq(items.familyId, familyId), eq(items.id, itemId))).execute());
}

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations, `${name}: ${results.violations.map(({id}) => id).join(", ")}`).toEqual([]);
  mkdirSync(shots, {recursive: true});
  await page.screenshot({path: `${shots}/${test.info().project.name}-${name}.png`, fullPage});
}

test("shows what Ana changed on a gift you are getting, until you keep it or let it go", async ({page, browser}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(phone.viewport);
  const familyId = await startFamily(page);
  try {
    const {ana, socks} = await seedAna(familyId);

    // Rosa marks the socks on Ana's list
    await page.goto(`/en/lists/${ana}`);
    const onList = page.getByRole("article", {name: "Cozy slipper socks"});
    await onList.getByRole("button", {name: lists.claim}).click();
    await expect(onList.getByText(lists.mine)).toBeVisible();

    // nothing has changed yet
    await page.goto("/en/lists/getting");
    const card = page.getByRole("article", {name: "Cozy slipper socks"});
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await expect(page.getByText(changed.title.replace("{name}", "Ana"))).toHaveCount(0);

    // Ana changes the size and the price
    await anaEdits(familyId, socks, {note: "Size 8 to 9, not 7 to 8", price: "14.50"});
    await page.reload();
    await expect(card.getByRole("heading", {name: changed.title.replace("{name}", "Ana")})).toBeVisible();
    await expect(card.locator("del").first()).toHaveText(`${changed.was} Size 7 to 8`);
    await expect(card.locator("ins").first()).toHaveText(`${changed.now} Size 8 to 9, not 7 to 8`);
    await expect(card.locator("del").nth(1)).toContainText("$12.97");
    await expect(card.locator("ins").nth(1)).toContainText("$14.50");
    await expect(card.getByLabel(lists.bought)).toHaveCount(0);
    // the book is unchanged and keeps its ticks
    await expect(page.getByRole("article", {name: "Sourdough baking book"}).getByLabel(lists.bought)).toBeChecked();
    await shoot(page, "f5-5_6-ana-changed-this");

    // Spanish
    await page.goto("/es/lists/getting");
    await expect(page.getByRole("heading", {name: es.lists.changed.title.replace("{name}", "Ana")})).toBeVisible();
    await expect(page.getByRole("button", {name: es.lists.changed.keep})).toBeVisible();
    await shoot(page, "es-f5-5_6-ana-changed-this");

    // the largest text size, with reduced motion: nothing cut off, and "Still getting it" still settles it
    const zoomed = await browser.newContext({...largest, reducedMotion: "reduce", storageState: await page.context().storageState()});
    try {
      const large = await zoomed.newPage();
      await large.goto("/en/lists/getting");
      const keep = large.getByRole("button", {name: changed.keep});
      await expect(keep).toBeVisible();
      expect(await large.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(large, "f5-5_6-ana-changed-this-200-percent", true);
      await keep.click();
      await expect(large.getByRole("status").filter({hasText: changed.kept})).toBeVisible();
      await expect(large.getByRole("article", {name: "Cozy slipper socks"}).getByLabel(lists.bought)).toBeVisible();
      await shoot(large, "f5-5_6-kept-200-percent-reduced-motion", true);
    } finally {
      await zoomed.close();
    }

    // seen once, gone for good
    await page.goto("/en/lists/getting");
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await expect(page.getByText(changed.title.replace("{name}", "Ana"))).toHaveCount(0);

    // Ana changes it again: "Still getting it" with motion
    await anaEdits(familyId, socks, {note: "Size 9 to 10"});
    await page.reload();
    await expect(card.locator("del")).toHaveText(`${changed.was} Size 8 to 9, not 7 to 8`);
    await card.getByRole("button", {name: changed.keep}).click();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await expect(page.getByRole("status").filter({hasText: changed.kept})).toBeVisible();
    await shoot(page, "f5-5_6-kept");

    // and once more: "Let it go" gives the gift back, with Undo
    await anaEdits(familyId, socks, {price: "16.00"});
    await page.reload();
    await card.getByRole("button", {name: changed.letGo}).click();
    await expect(page.getByRole("status").filter({hasText: changed.letGone})).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, socks)))).toEqual([]);
    await page.getByRole("button", {name: en.ui.undo}).click();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await expect(page.getByText(changed.title.replace("{name}", "Ana"))).toHaveCount(0);
  } finally {
    await withDatabase(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

test("a photo-only owner edit shows the current picture, and Undo restores Bought and Wrapped", async ({page, browser}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(phone.viewport);
  const familyId = await startFamily(page);
  const member = await browser.newContext({viewport: phone.viewport, ignoreHTTPSErrors: true});
  try {
    await page.locator("summary").filter({hasText: /^Add a person$/}).click();
    await page.getByRole("textbox", {name: en.auth.name}).fill("Ana");
    await page.getByRole("button", {name: en.auth.addMember}).click();
    await expect(page.getByRole("heading", {name: "Ana"})).toBeVisible();
    await page.getByRole("link", {name: en.auth.sendKeys}).click();
    await page.getByRole("button", {name: en.auth.prepareKey}).click();
    const url = (await page.getByText("Hi Ana! This is your private key", {exact: false}).innerText()).split(" ").at(-1)!;
    const buyer = await member.newPage();
    await openKey(buyer, url, pin);
    await skipFaceId(buyer);

    const ownerId = await withDatabase(familyId, async (tx) => {
      const [rosa] = await tx.select({id: people.id}).from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, "Rosa")));
      return rosa.id;
    });
    const upload = async (color: string) => ({name: "slippers.png", mimeType: "image/png",
      buffer: await sharp({create: {width: 80, height: 80, channels: 3, background: color}}).png().toBuffer()});
    await page.goto(`/en/lists/${ownerId}/items/new?kind=photo`);
    await page.getByLabel(lists.photo, {exact: true}).setInputFiles(await upload("#c33136"));
    await page.getByLabel(lists.title).fill("Christmas slippers");
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("article", {name: "Christmas slippers"})).toBeVisible();
    const [item] = await withDatabase(familyId, (tx) => tx.select().from(items).where(eq(items.ownerId, ownerId)));
    await buyer.goto(`/en/lists/${ownerId}`);
    await buyer.getByRole("article", {name: item.title}).getByRole("button", {name: lists.claim}).click();
    await expect(buyer.getByText(lists.mine, {exact: true})).toBeVisible();
    await buyer.goto("/en/lists/getting");
    const card = buyer.getByRole("article", {name: item.title});
    for (const label of [lists.bought, lists.wrapped]) {
      await card.getByLabel(label).check();
      await expect(card.getByLabel(label)).toBeEnabled();
    }
    const [before] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, item.id)));
    const oldPhoto = before.seen!.imageKey!;

    await page.goto(`/en/lists/${ownerId}/items/${item.id}/edit`);
    await page.getByLabel(lists.replacePhoto, {exact: true}).setInputFiles(await upload("#287454"));
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("article", {name: item.title})).toBeVisible();
    // The owner never sees a reservation or the buyer's change acknowledgment.
    await expect(page.getByText(lists.mine, {exact: true})).toHaveCount(0);
    await expect(page.getByText(lists.someone, {exact: true})).toHaveCount(0);
    await buyer.reload();
    await expect(card.getByText(changed.newPicture, {exact: true})).toBeVisible();
    await expect(card.locator("del")).toHaveCount(0);
    const image = card.locator("img");
    await expect(image).toBeVisible();
    expect(await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    const response = await buyer.request.get((await image.getAttribute("src"))!);
    expect(response.headers()["content-type"]).toBe("image/webp");
    const [current] = await withDatabase(familyId, (tx) => tx.select().from(items).where(eq(items.id, item.id)));
    expect(current.imageKey).not.toBe(oldPhoto);
    expect(existsSync(join(process.env.LIST_PHOTO_DIR!, oldPhoto))).toBe(false);
    expect(await response.body()).toEqual(readFileSync(join(process.env.LIST_PHOTO_DIR!, current.imageKey!)));
    const [stillUnseen] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, item.id)));
    expect(stillUnseen.seen).toEqual(before.seen);
    await shoot(buyer, "photo-only-current-picture", true);
    await buyer.goto("/es/lists/getting");
    await expect(buyer.getByText(es.lists.changed.newPicture, {exact: true})).toBeVisible();
    await shoot(buyer, "es-photo-only-current-picture", true);
    await buyer.goto("/en/lists/getting");
    await card.getByRole("button", {name: changed.letGo}).click();
    await expect(card).toHaveCount(0);
    expect(await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, item.id)))).toEqual([]);
    await buyer.getByRole("button", {name: en.ui.undo, exact: true}).click();
    for (const label of [lists.bought, lists.wrapped]) await expect(card.getByLabel(label)).toBeChecked();
    await buyer.reload();
    for (const label of [lists.bought, lists.wrapped]) await expect(card.getByLabel(label)).toBeChecked();
    await expect(card.getByText(changed.newPicture, {exact: true})).toHaveCount(0);
    const [restored] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, item.id)));
    expect(restored.seen?.imageKey).toBe(current.imageKey);
    expect(restored.boughtAt).not.toBeNull();
    expect(restored.wrappedAt).not.toBeNull();
    await shoot(buyer, "undo-restores-bought-and-wrapped", true);
    writeFileSync(join(shots, `${test.info().project.name}-photo-undo-state.json`), JSON.stringify({
      oldPhotoDeleted: true, currentPictureServed: true, before: before.seen, after: restored.seen,
      bought: Boolean(restored.boughtAt), wrapped: Boolean(restored.wrappedAt),
    }, null, 2));
  } finally {
    await member.close();
    await withDatabase(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

test("a second owner edit cannot be acknowledged from an older changed card", async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(phone.viewport);
  const familyId = await startFamily(page);
  try {
    const {ana, socks} = await seedAna(familyId);
    await page.goto(`/en/lists/${ana}`);
    await page.getByRole("article", {name: "Cozy slipper socks"}).getByRole("button", {name: lists.claim}).click();
    await expect(page.getByRole("article", {name: "Cozy slipper socks"}).getByText(lists.mine, {exact: true})).toBeVisible();
    await anaEdits(familyId, socks, {note: "Large"});
    await page.goto("/en/lists/getting");
    const card = page.getByRole("article", {name: "Cozy slipper socks"});
    await expect(card.locator("ins")).toHaveText(`${changed.now} Large`);
    await anaEdits(familyId, socks, {note: "Extra large"});
    await card.getByRole("button", {name: changed.keep}).click();
    await expect(page.getByRole("status").filter({hasText: lists.feedback["item-changed"]})).toBeVisible();
    await expect(card.locator("ins")).toHaveText(`${changed.now} Extra large`);
    const [rejected] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, socks)));
    expect(rejected.seen?.note).toBe("Size 7 to 8");
    await shoot(page, "stale-acknowledgment-rejected", true);
    await card.getByRole("button", {name: changed.keep}).click();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await page.reload();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    const [accepted] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, socks)));
    expect(accepted.seen?.note).toBe("Extra large");
    writeFileSync(join(shots, `${test.info().project.name}-acknowledgment-state.json`), JSON.stringify({
      afterStaleClick: rejected.seen, afterCurrentClick: accepted.seen,
    }, null, 2));
  } finally {
    await withDatabase(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

test("shows changed titles, cleared details and a different page at the same store, and ignores reverted edits", async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(phone.viewport);
  const familyId = await startFamily(page);
  try {
    const {ana, socks} = await seedAna(familyId);
    await withDatabase(familyId, (tx) => tx.update(items).set({
      kind: "link", url: "https://shop.example.com/slippers-red", store: "shop.example.com",
    }).where(eq(items.id, socks)).execute());
    await page.goto(`/en/lists/${ana}`);
    const original = page.getByRole("article", {name: "Cozy slipper socks"});
    await original.getByRole("button", {name: lists.claim}).click();
    await expect(original.getByText(lists.mine, {exact: true})).toBeVisible();
    await withDatabase(familyId, (tx) => tx.update(items).set({
      title: "Purple slipper socks", note: null, price: null,
      url: "https://shop.example.com/slippers-purple", updatedAt: new Date(),
    }).where(eq(items.id, socks)).execute());
    await page.goto("/en/lists/getting");
    const card = page.getByRole("article", {name: "Purple slipper socks"});
    await expect(card.locator("del")).toHaveText([
      `${changed.was} Cozy slipper socks`, `${changed.was} Size 7 to 8`, `${changed.was} $12.97`, `${changed.was} At shop.example.com`,
    ]);
    await expect(card.locator("ins")).toHaveText([
      `${changed.now} Purple slipper socks`, `${changed.now} ${changed.noNote}`, `${changed.now} ${changed.noPrice}`,
      `${changed.now} ${changed.newLinkAt.replace("{store}", "shop.example.com")}`,
    ]);
    await expect(card.locator("ins a")).toHaveAttribute("href", "https://shop.example.com/slippers-purple");
    await shoot(page, "title-cleared-details-same-store-link", true);
    await card.getByRole("button", {name: changed.keep}).click();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    // An owner may change their mind. Only the final values matter, not the edit timestamp.
    await anaEdits(familyId, socks, {note: "Any color"});
    await page.reload();
    await expect(card.locator("ins")).toHaveText(`${changed.now} Any color`);
    await withDatabase(familyId, (tx) => tx.update(items).set({note: null, updatedAt: new Date()}).where(eq(items.id, socks)).execute());
    await page.reload();
    await expect(card.getByLabel(lists.bought)).toBeVisible();
    await expect(card.locator("del")).toHaveCount(0);
    await shoot(page, "reverted-edit-has-no-warning", true);
  } finally {
    await withDatabase(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

test("Undo cannot take a released gift or copy progress onto someone else's reservation", async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(phone.viewport);
  const familyId = await startFamily(page);
  try {
    const {ana, socks} = await seedAna(familyId);
    await page.goto(`/en/lists/${ana}`);
    const onList = page.getByRole("article", {name: "Cozy slipper socks"});
    await onList.getByRole("button", {name: lists.claim}).click();
    await expect(onList.getByText(lists.mine, {exact: true})).toBeVisible();
    await page.goto("/en/lists/getting");
    const card = page.getByRole("article", {name: "Cozy slipper socks"});
    for (const label of [lists.bought, lists.wrapped]) {
      await card.getByLabel(label).check();
      await expect(card.getByLabel(label)).toBeEnabled();
    }
    await anaEdits(familyId, socks, {note: "Large"});
    await page.reload();
    await card.getByRole("button", {name: changed.letGo}).click();
    await expect(card).toHaveCount(0);
    const other = await withDatabase(familyId, async (tx) => {
      const [person] = await tx.insert(people).values({familyId, displayName: "Caro"}).returning({id: people.id});
      await tx.insert(claims).values({familyId, itemId: socks, claimerId: person.id});
      return person.id;
    });
    await page.getByRole("button", {name: en.ui.undo, exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: lists.feedback["already-claimed"]})).toBeVisible();
    const [reserved] = await withDatabase(familyId, (tx) => tx.select().from(claims).where(eq(claims.itemId, socks)));
    expect(reserved.claimerId).toBe(other);
    expect(reserved.boughtAt).toBeNull();
    expect(reserved.wrappedAt).toBeNull();
    await expect(card).toHaveCount(0);
    await shoot(page, "undo-after-someone-else-claims", true);
  } finally {
    await withDatabase(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});
