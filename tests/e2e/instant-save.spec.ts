import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, items, people} from "../../src/server/db/schema";

// 4.4: a pasted link lands on the list at once ("Saved. The picture is on its way.") and turns into the
// item when its store page has been read, without a reload. Photographed into test-results/design/.

const pin = "4268";
const phone = {width: 390, height: 844};
const shots = process.env.E2E_EVIDENCE_DIR || "test-results/design";
const {lists} = en;
const coming = (store: string, messages = lists) => messages.pictureComing.replace("{store}", store);

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for wishlist browser tests");
  return connectDatabase(databaseUrl);
}

async function seed<T>(familyId: string, action: Parameters<typeof runForFamily<T>>[2]) {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, action);
  } finally {
    await close();
  }
}

async function startFamily(page: Page) {
  const {auth} = en;
  const familyName = `Tinselwood ${randomUUID().slice(0, 6)}`;
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
  const familyId = session!.value.split(".")[0];
  const [rosa] = await seed(familyId, (tx) => tx.select({id: people.id}).from(people).where(eq(people.familyId, familyId)));
  return {familyId, rosa: rosa.id};
}

function picture(background: string, art: string) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 100 100"><rect width="100" height="100" fill="${background}"/>${art}</svg>`))
    .png().toBuffer();
}

/** Two things with photos, added the way a person would, so the list looks like the frame's. */
async function addPhotos(page: Page, rosa: string) {
  const things = [
    {title: "Garden pruners", price: "24.97", file: await picture("#E5EDE3", '<path d="M47 48 34 80c-1 3 3 5 5 3l14-28z" fill="#D2452F"/><path d="M53 48l13 32c1 3-3 5-5 3L47 55z" fill="#E86A3E"/><path d="M48 50 28 22c-2-3 1-6 4-4l22 26z" fill="#B9C0C4"/><path d="M52 50 72 22c2-3-1-6-4-4L46 44z" fill="#D7DCDF"/>')},
    {title: "Fleece robe", price: "39.99", note: "Size M, any dark color", file: await picture("#E9E4E0", '<path d="M30 22l10-6h20l10 6 8 54-14 6H36l-14-6z" fill="#2F3438"/><path d="M30 52h40" stroke="#5B6267" stroke-width="5" stroke-linecap="round"/>')},
  ];
  for (const thing of things) {
    await page.goto(`/en/lists/${rosa}/items/new?kind=photo`);
    await page.getByLabel(lists.photo).setInputFiles({name: "thing.png", mimeType: "image/png", buffer: thing.file});
    await expect(page.getByLabel(lists.replacePhoto)).toBeAttached();
    await page.getByLabel(lists.title).fill(thing.title);
    await page.getByLabel(lists.price).fill(thing.price);
    if (thing.note) await page.getByRole("textbox", {name: lists.note, exact: true}).fill(thing.note);
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("article", {name: thing.title})).toBeVisible();
  }
}

/** A link saved a moment ago whose store page is still being read: what the save leaves behind. */
async function seedComing(familyId: string, rosa: string) {
  const [item] = await seed(familyId, (tx) => tx.insert(items).values({
    familyId, ownerId: rosa, kind: "link", title: "fleece robe", store: "Target", position: -1,
    url: "https://www.target.com/p/fleece-robe/-/A-12345",
    preview: {title: "fleece robe", icon: "target", productId: "12345", pending: Date.now()},
  }).returning({id: items.id}));
  return item.id;
}

async function shoot(page: Page, name: string, options: {axe?: boolean} = {}) {
  // Let the entrance animations settle while the loading stitches keep shimmering.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"
    || animation.effect?.getComputedTiming().iterations === Infinity));
  if (options.axe !== false) {
    const results = await new AxeBuilder({page}).analyze();
    expect(results.violations, `${name}: ${results.violations.map(({id}) => id).join(", ")}`).toEqual([]);
  }
  mkdirSync(shots, {recursive: true});
  await page.screenshot({path: `${shots}/${test.info().project.name}-${name}.png`});
}

test("a typed link saves with the first tap while the link field is focused", async ({page}) => {
  await page.setViewportSize(phone);
  const {familyId, rosa} = await startFamily(page);
  try {
    const listPath = `/en/lists/${rosa}`;
    await page.goto(`${listPath}/items/new?kind=link`);
    const link = page.getByLabel(lists.url);
    await link.fill("https://gifts.invalid/winter/wool-socks");
    await expect(link).toBeFocused();
    const started = Date.now();
    await page.getByRole("button", {name: lists.saveItem}).tap();
    await expect(page.getByRole("status").filter({hasText: lists.added})).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === listPath);
    expect(Date.now() - started).toBeLessThan(10_000);
    const saved = await seed(familyId, (tx) => tx.select({url: items.url}).from(items).where(eq(items.ownerId, rosa)));
    expect(saved).toEqual([{url: "https://gifts.invalid/winter/wool-socks"}]);
    const socks = page.getByRole("article", {name: "wool socks"});
    await expect(socks.getByText(lists.noPicture.replace("{store}", "gifts.invalid"))).toBeVisible({timeout: 40_000});
    await expect(page.getByText(coming("gifts.invalid"))).toHaveCount(0);
  } finally {
    await seed(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

test("a pasted link saves at once and its picture follows without a reload", async ({page}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(phone);
  const {familyId, rosa} = await startFamily(page);
  try {
    const listPath = `/en/lists/${rosa}`;
    await addPhotos(page, rosa);

    // 4.4: added, the picture on its way, and the toast
    const robeId = await seedComing(familyId, rosa);
    await page.goto(`${listPath}?done=added`);
    const card = page.getByRole("status").filter({hasText: coming("Target")});
    await expect(card).toBeVisible();
    await expect(card).toContainText(lists.pictureComingSub);
    await expect(page.getByText("3 things")).toBeVisible();
    await expect(page.getByRole("status").filter({hasText: lists.added})).toBeVisible();
    await shoot(page, "f4-4_4-picture-coming");

    // The store's page arrives: the card becomes the item, with its name and price, without a reload
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    await seed(familyId, (tx) => tx.update(items).set({
      title: "Cozy Fleece Robe", price: "39.99", updatedAt: new Date(),
      preview: {title: "Cozy Fleece Robe", price: "39.99", icon: "target", productId: "12345"},
    }).where(and(eq(items.familyId, familyId), eq(items.id, robeId))).execute());
    const robe = page.getByRole("article", {name: "Cozy Fleece Robe"});
    await expect(robe).toBeVisible({timeout: 10_000});
    await expect(robe.getByText("$39.99")).toBeVisible();
    await expect(page.getByText(coming("Target"))).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
    await shoot(page, "f4-4_4-picture-landed");
    await seed(familyId, (tx) => tx.delete(items).where(and(eq(items.familyId, familyId), eq(items.id, robeId))).execute());

    // The largest text size: about 135% of the default
    await seedComing(familyId, rosa);
    await page.goto(listPath);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.35";
    });
    await expect(card).toBeVisible();
    await shoot(page, "large-text-f4-4_4-picture-coming", {axe: false});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // Reduced motion: the stitches hold still
    await page.evaluate(() => document.documentElement.style.removeProperty("zoom"));
    await page.emulateMedia({reducedMotion: "reduce"});
    const stitch = page.locator("[data-picture-coming] .fge-ts").first();
    await expect(stitch).toBeAttached();
    await expect(stitch).toHaveCSS("animation-name", "none");
    await shoot(page, "reduced-motion-f4-4_4-picture-coming");

    // Keep the locale change in its own tab so the pending card's refresh cannot interrupt it.
    const spanish = await page.context().newPage();
    await spanish.setViewportSize(phone);
    await spanish.goto(`/es/lists/${rosa}`);
    const spanishCard = spanish.getByRole("status").filter({hasText: coming("Target", es.lists)});
    await expect(spanishCard).toBeVisible();
    await expect(spanishCard).toContainText(es.lists.pictureComingSub);
    await shoot(spanish, "es-f4-4_4-picture-coming");
  } finally {
    await seed(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});
