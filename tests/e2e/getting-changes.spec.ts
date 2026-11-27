import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type BrowserContextOptions, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {claims, families, items, people} from "../../src/server/db/schema";

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
