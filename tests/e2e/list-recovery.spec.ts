import {randomUUID} from "node:crypto";
import {expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {Pool} from "pg";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import {connectDatabase, runForFamily, type FamilyTransaction} from "../../src/server/db/database";
import {claims, exchanges, families, items, people, sizes} from "../../src/server/db/schema";

const {auth, lists, ui} = en;
const pin = "4268";

type Fixture = {familyId: string; ownerId: string; sessionId: string; path: string; itemId: string; secondId: string; relativeId: string};

async function database<T>(familyId: string, action: (tx: FamilyTransaction) => Promise<T>) {
  const connection = connectDatabase(process.env.DATABASE_URL!);
  try { return await runForFamily(connection.db, familyId, action); }
  finally { await connection.close(); }
}

async function setup(page: Page): Promise<Fixture> {
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(`Recovery ${randomUUID().slice(0, 6)}`);
  await page.getByLabel(auth.yourName).fill("Holly");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("link", {name: auth.sendKeys})).toBeVisible();
  const cookie = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!;
  const [familyId, sessionId] = cookie.value.split(".");
  return database(familyId, async (tx) => {
    const [owner] = await tx.select({id: people.id}).from(people).where(eq(people.familyId, familyId));
    const [relative] = await tx.insert(people).values({familyId, displayName: "Ivy", helperId: owner.id}).returning({id: people.id});
    const [first, second] = await tx.insert(items).values([
      {familyId, ownerId: owner.id, title: "Tea tin", kind: "note", position: 0},
      {familyId, ownerId: owner.id, title: "Winter book", kind: "note", position: 1},
      {familyId, ownerId: relative.id, title: "Puzzle A", kind: "note", position: 0},
      {familyId, ownerId: relative.id, title: "Puzzle B", kind: "note", position: 1},
    ]).returning({id: items.id});
    return {familyId, sessionId, ownerId: owner.id, relativeId: relative.id,
      path: `/en/lists/${owner.id}`, itemId: first.id, secondId: second.id};
  });
}

async function cleanup(fixture: Fixture) {
  await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
}

function card(page: Page, title = "Tea tin") { return page.getByRole("article", {name: title, exact: true}); }
async function edit(page: Page, title = "Tea tin") {
  await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", title), exact: true}).click();
  const sheet = page.getByRole("dialog", {name: lists.editItem});
  await expect(sheet).toBeVisible();
  return sheet;
}
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(700);
  await page.screenshot({path: test.info().outputPath(`${name}.png`), fullPage});
}
async function errorToast(page: Page) {
  await expect(page.getByRole("status").filter({hasText: lists.feedback["could-not-save"]})).toBeVisible({timeout: 10_000});
}
async function savedPost(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse((entry) => entry.request().method() === "POST");
  await action();
  expect((await response).ok()).toBe(true);
}

test("keeps a pending removal hidden across tabs, Undo preserves it, and an offline deletion restores it", async ({page}) => {
  const fixture = await setup(page);
  try {
    await page.goto(fixture.path);
    await (await edit(page)).getByRole("button", {name: lists.deleteItem}).click();
    await expect(card(page)).toHaveCount(0);
    await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.family}).click();
    await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.list}).click();
    await expect(card(page)).toHaveCount(0);
    await page.getByRole("button", {name: ui.undo, exact: true}).click();
    await expect(card(page)).toBeVisible();
    await page.waitForTimeout(5600);
    await page.reload();
    await expect(card(page)).toBeVisible();
    await shot(page, "undo-after-navigation-preserved-item");

    await (await edit(page)).getByRole("button", {name: lists.deleteItem}).click();
    await page.context().setOffline(true);
    await errorToast(page);
    await expect(card(page)).toBeVisible();
    await shot(page, "offline-removal-restored");
    await page.context().setOffline(false);
    await page.reload();
    await expect(card(page)).toBeVisible();
    const state = await database(fixture.familyId, (tx) => tx.select({id: items.id, title: items.title}).from(items).where(eq(items.id, fixture.itemId)));
    expect(state).toHaveLength(1);
    await test.info().attach("preserved-item", {body: JSON.stringify(state), contentType: "application/json"});
  } finally { await page.context().setOffline(false).catch(() => {}); await cleanup(fixture); }
});

test("reconciles heart edits and displays a replacement photo without reloading the list", async ({page}) => {
  const fixture = await setup(page);
  const photo = (background: string) => sharp({create: {width: 100, height: 100, channels: 3, background}}).png().toBuffer();
  try {
    await database(fixture.familyId, (tx) => tx.update(items).set({kind: "photo"}).where(eq(items.id, fixture.itemId)).execute());
    await page.goto(fixture.path);
    const heart = card(page).getByRole("button", {name: lists.star});
    await savedPost(page, () => heart.click());
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    let sheet = await edit(page);
    await sheet.getByLabel(lists.star, {exact: true}).uncheck();
    await sheet.getByLabel(lists.photo, {exact: true}).setInputFiles({name: "red.png", mimeType: "image/png", buffer: await photo("#f00000")});
    await sheet.getByRole("button", {name: lists.saveItem}).click();
    await expect(sheet).toBeHidden();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    const image = card(page).locator("img");
    const original = await image.getAttribute("src");
    sheet = await edit(page);
    await expect(sheet.getByLabel(lists.star, {exact: true})).not.toBeChecked();
    await sheet.getByLabel(lists.replacePhoto, {exact: true}).setInputFiles({name: "green.png", mimeType: "image/png", buffer: await photo("#00e000")});
    await sheet.getByRole("button", {name: lists.saveItem}).click();
    await expect(sheet).toBeHidden();
    await expect(image).not.toHaveAttribute("src", original!);
    await expect.poll(() => image.evaluate((entry: HTMLImageElement) => entry.complete && entry.naturalWidth > 0)).toBe(true);
    const url = await image.getAttribute("src");
    const pixels = await sharp(await (await page.request.get(url!)).body()).raw().toBuffer();
    expect(pixels[1]).toBeGreaterThan(pixels[0] + 100);
    await page.waitForTimeout(2000);
    // Full-page mobile capture resizes the viewport and can move the fixed tab pill during capture.
    await shot(page, "replacement-photo-and-unstarred-heart", false);
    const barGeometry = await page.getByRole("navigation", {name: ui.tabs.label}).evaluate((bar) => {
      const active = bar.querySelector('[aria-current="page"]')!.getBoundingClientRect();
      const pill = bar.querySelector(".fge-tab-pill")!.getBoundingClientRect();
      return {active: {left: active.left, width: active.width}, pill: {left: pill.left, width: pill.width}};
    });
    await test.info().attach("photo-save-tab-geometry", {body: JSON.stringify(barGeometry, null, 2), contentType: "application/json"});
    expect(Math.abs(barGeometry.active.left - barGeometry.pill.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(barGeometry.active.width - barGeometry.pill.width)).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
  } finally { await cleanup(fixture); }
});

test("recovers offline heart, order, item draft, preview, budget and size saves and permits retry", async ({page}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page);
  try {
    await database(fixture.familyId, (tx) => tx.insert(items).values({
      familyId: fixture.familyId, ownerId: fixture.ownerId, kind: "link", title: "Motor driver",
      url: "https://www.pololu.com/product/2133", store: "pololu.com", position: 2,
    }).execute());
    await page.goto(fixture.path);
    const heart = card(page).getByRole("button", {name: lists.star});
    await page.context().setOffline(true);
    await heart.click();
    await errorToast(page);
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    let sheet = await edit(page);
    await sheet.getByRole("button", {name: lists.moveDown}).click();
    await errorToast(page);
    await expect(card(page)).toBeVisible();
    await (await edit(page, "Winter book")).getByRole("button", {name: lists.moveUp}).click();
    await errorToast(page);
    await (await edit(page, "Motor driver")).getByRole("button", {name: lists.refresh}).click();
    await errorToast(page);
    sheet = await edit(page);
    await sheet.getByRole("textbox", {name: lists.note, exact: true}).fill("Keep my draft");
    await sheet.getByRole("button", {name: lists.saveItem}).click();
    await expect(sheet.getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
    await expect(sheet.getByRole("textbox", {name: lists.note, exact: true})).toHaveValue("Keep my draft");
    await shot(page, "offline-edit-draft-preserved");
    await page.context().setOffline(false);
    await sheet.getByRole("button", {name: lists.saveItem}).click();
    await expect(sheet).toBeHidden();
    await expect(card(page).getByText("Keep my draft")).toBeVisible();
    await savedPost(page, () => heart.click());
    await expect(heart).toHaveAttribute("aria-pressed", "true");

    await savedPost(page, async () => (await edit(page)).getByRole("button", {name: lists.moveDown}).click());
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Winter book");
    await savedPost(page, async () => (await edit(page)).getByRole("button", {name: lists.moveUp}).click());
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Tea tin");
    await savedPost(page, async () => (await edit(page, "Motor driver")).getByRole("button", {name: lists.refresh}).click());
    await expect(page.getByRole("article").locator("img")).toBeVisible();

    await page.goto(`${fixture.path}/items/new?kind=link`);
    await page.waitForLoadState("networkidle");
    await page.context().setOffline(true);
    await page.getByLabel(lists.url).fill("https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html");
    await page.getByRole("button", {name: lists.preview, exact: true}).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
    await shot(page, "offline-preview-feedback");
    await page.context().setOffline(false);
    await page.getByLabel(lists.url).fill("https://www.pololu.com/product/2133");
    await page.getByRole("button", {name: lists.preview, exact: true}).click();
    await expect(page.getByRole("region", {name: lists.previewTitle}).getByText("DRV8825 Stepper Motor Driver Carrier, High Current", {exact: true})).toBeVisible();

    await page.goto(`${fixture.path}/items/new?kind=note`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(lists.title).fill("Draft after disconnect");
    await page.context().setOffline(true);
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
    await expect(page.getByLabel(lists.title)).toHaveValue("Draft after disconnect");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(card(page, "Draft after disconnect")).toBeVisible();

    await page.goto("/en/lists");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(lists.budget, {exact: true}).fill("42");
    await page.context().setOffline(true);
    await page.getByRole("button", {name: lists.saveBudget}).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
    await expect(page.getByLabel(lists.budget, {exact: true})).toHaveValue("42");
    await shot(page, "offline-budget-feedback");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: lists.saveBudget}).click();
    await expect(page.getByText("Gift budget: $42.00", {exact: true})).toBeVisible();

    await page.goto(`${fixture.path}/profile`);
    await page.waitForLoadState("networkidle");
    const noClothes = page.getByRole("switch", {name: lists.noClothes});
    await page.context().setOffline(true);
    await noClothes.click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
    await expect(noClothes).toHaveAttribute("aria-checked", "false");
    await page.getByRole("group", {name: lists.size.tops}).getByText("M", {exact: true}).click();
    await expect(page.getByRole("group", {name: lists.size.tops}).getByRole("radio", {name: "M", exact: true})).not.toBeChecked();
    await page.getByLabel(lists.size.shoeSystem).selectOption("eu");
    await expect(page.getByLabel(lists.size.shoeSystem)).toHaveValue("");
    await page.getByLabel(lists.aboutField.likes, {exact: true}).fill("Puzzles");
    await page.getByLabel(lists.aboutField.likes, {exact: true}).blur();
    await expect(page.getByLabel(lists.aboutField.likes, {exact: true})).toHaveValue("Puzzles");
    await shot(page, "offline-profile-feedback-and-draft");
    await page.context().setOffline(false);
    await savedPost(page, async () => {
      await page.getByLabel(lists.aboutField.likes, {exact: true}).focus();
      await page.getByLabel(lists.aboutField.likes, {exact: true}).blur();
    });
    await savedPost(page, () => noClothes.click());
    await expect(noClothes).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(noClothes).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel(lists.aboutField.likes, {exact: true})).toHaveValue("Puzzles");
  } finally { await page.context().setOffline(false).catch(() => {}); await cleanup(fixture); }
});

test.describe("profile autosave transport recovery", () => {
  // Service-worker fetches bypass page.route in WebKit; these races must intercept the first POST.
  test.use({serviceWorkers: "block"});

  for (const field of ["noClothes", "tops", "shoes", "shoeSystem"] as const) {
    test(`keeps the newest repeated ${field} edit when its earlier network request fails`, async ({page}) => {
      const fixture = await setup(page);
      try {
        await database(fixture.familyId, (tx) => tx.insert(sizes).values([
          {familyId: fixture.familyId, personId: fixture.ownerId, kind: "tops", value: "M"},
          {familyId: fixture.familyId, personId: fixture.ownerId, kind: "shoeSystem", value: "us-women"},
          {familyId: fixture.familyId, personId: fixture.ownerId, kind: "shoes", value: "7"},
        ]).execute());
        await page.goto(`${fixture.path}/profile`);
        await page.waitForLoadState("networkidle");
        let release!: () => void;
        let entered!: () => void;
        const blocked = new Promise<void>((resolve) => { entered = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let firstRequest = true;
        await page.route("**/*", async (route) => {
          if (route.request().method() !== "POST" || !firstRequest) return route.continue();
          firstRequest = false;
          entered();
          await gate;
          await route.abort("internetdisconnected");
        });
        const toggle = page.getByRole("switch", {name: lists.noClothes});
        const change = async (next: boolean) => {
          if (field === "noClothes") await toggle.click();
          else if (field === "tops") await page.getByRole("group", {name: lists.size.tops}).getByText(next ? "L" : "M", {exact: true}).click();
          else if (field === "shoes") await page.getByRole("button", {name: next ? lists.shoeBigger : lists.shoeSmaller}).click();
          else await page.getByLabel(lists.size.shoeSystem).selectOption(next ? "eu" : "us-women");
        };
        const expectLatest = async () => {
          if (field === "noClothes") await expect(toggle).toHaveAttribute("aria-checked", "true");
          else if (field === "tops") await expect(page.getByRole("group", {name: lists.size.tops}).getByRole("radio", {name: "L", exact: true})).toBeChecked();
          else if (field === "shoes") await expect(page.getByLabel(lists.size.shoes, {exact: true})).toHaveValue("7½");
          else await expect(page.getByLabel(lists.size.shoeSystem)).toHaveValue("eu");
        };
        await change(true);
        await blocked;
        await change(false);
        await change(true);
        await expectLatest();
        const retry = page.waitForResponse((response) => response.request().method() === "POST");
        release();
        expect((await retry).ok()).toBe(true);
        await expectLatest();
        await expect(page.getByRole("status").filter({hasText: lists.saved})).toBeVisible();
        await shot(page, `repeated-${field}-final-value-saved`);
        await page.reload();
        await expectLatest();
      } finally { await cleanup(fixture); }
    });
  }
});

test("rolls back offline claims and checklist ticks, then reconciles claim changes from another tab", async ({page}) => {
  const fixture = await setup(page);
  const other = await page.context().newPage();
  try {
    const path = `/en/lists/${fixture.relativeId}`;
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const first = card(page, "Puzzle A");
    await page.context().setOffline(true);
    await first.getByRole("button", {name: lists.claim, exact: true}).click();
    await errorToast(page);
    await expect(first.getByRole("button", {name: lists.claim, exact: true})).toBeEnabled();
    await shot(page, "offline-claim-rolled-back");
    await page.context().setOffline(false);
    await first.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(first).toHaveAttribute("aria-busy", "false");
    await expect(first.getByText(lists.mine, {exact: true})).toBeVisible();
    await page.context().setOffline(true);
    await first.getByRole("button", {name: lists.undoClaim, exact: true}).click();
    await errorToast(page);
    await expect(first.getByText(lists.mine, {exact: true})).toBeVisible();
    await page.context().setOffline(false);

    await page.goto("/en/lists/getting");
    await page.waitForLoadState("networkidle");
    const getting = card(page, "Puzzle A");
    for (const label of [lists.bought, lists.wrapped]) {
      await page.context().setOffline(true);
      // A fast rejection can roll back before check() verifies its intermediate checked state.
      await getting.getByLabel(label, {exact: true}).click();
      await expect(getting.getByRole("alert")).toHaveText(lists.feedback["could-not-save"]);
      await expect(getting.getByLabel(label, {exact: true})).not.toBeChecked();
      await page.context().setOffline(false);
      await getting.getByLabel(label, {exact: true}).check();
      await expect(getting.getByLabel(label, {exact: true})).toBeEnabled();
    }
    await shot(page, "checklist-retry-saved");
    await page.reload();
    await expect(getting.getByLabel(lists.bought, {exact: true})).toBeChecked();
    await expect(getting.getByLabel(lists.wrapped, {exact: true})).toBeChecked();

    await page.goto(path);
    await other.goto(path);
    await card(other, "Puzzle A").getByRole("button", {name: lists.undoClaim, exact: true}).click();
    await expect(card(other, "Puzzle A").getByRole("button", {name: lists.claim, exact: true})).toBeEnabled();
    const second = card(page, "Puzzle B");
    await second.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(second).toHaveAttribute("aria-busy", "false");
    await expect(second.getByText(lists.mine, {exact: true})).toBeVisible();
    await expect(first.getByRole("button", {name: lists.claim, exact: true})).toBeEnabled();
    await expect(first.getByText(lists.mine, {exact: true})).toBeHidden();
    await shot(page, "cross-tab-claim-reconciled");
  } finally { await page.context().setOffline(false).catch(() => {}); await other.close(); await cleanup(fixture); }
});

for (const operation of ["edit", "claim", "undo", "budget", "acting-profile"] as const) {
  test(`denies a queued ${operation} after its session or authority changes under the family lock`, async ({page}) => {
    const fixture = await setup(page);
    const pool = new Pool({connectionString: process.env.DATABASE_URL});
    const blocker = await pool.connect();
    try {
      if (operation === "claim" || operation === "undo") {
        await page.goto(`/en/lists/${fixture.relativeId}`);
        if (operation === "undo") {
          await card(page, "Puzzle A").getByRole("button", {name: lists.claim, exact: true}).click();
          await expect(card(page, "Puzzle A")).toHaveAttribute("aria-busy", "false");
        }
      } else if (operation === "budget") {
        await page.goto("/en/lists");
        await page.getByLabel(lists.budget, {exact: true}).fill("77");
      } else {
        await page.goto(fixture.path);
      }
      await page.waitForLoadState("networkidle");
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [fixture.familyId]);
      const response = page.waitForResponse((entry) => entry.request().method() === "POST");
      if (operation === "claim" || operation === "undo") {
        await card(page, "Puzzle A").getByRole("button", {name: operation === "claim" ? lists.claim : lists.undoClaim, exact: true}).click();
      } else if (operation === "budget") {
        await page.getByRole("button", {name: lists.saveBudget}).click();
      } else {
        await card(page).getByRole("button", {name: lists.star}).click();
      }
      // A real app request has resolved its viewer and is waiting on the locked family row.
      await expect.poll(async () => {
        const {rows} = await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
        return rows[0].count;
      }).toBeGreaterThan(0);
      if (operation === "budget") {
        await blocker.query("UPDATE people SET role='member' WHERE id=$1", [fixture.ownerId]);
      } else if (operation === "acting-profile") {
        await blocker.query("UPDATE sessions SET acting_as=$1 WHERE id=$2", [fixture.relativeId, fixture.sessionId]);
      } else {
        await blocker.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [fixture.sessionId]);
      }
      await blocker.query("COMMIT");
      const body = await (await response).text();
      expect(body).toContain("forbidden");
      await test.info().attach("denied-action-response", {body, contentType: "text/plain"});
      await shot(page, `queued-${operation}-denied`);
      const state = await database(fixture.familyId, async (tx) => ({
        item: await tx.select({starred: items.starred}).from(items).where(eq(items.id, fixture.itemId)),
        claims: await tx.select({itemId: claims.itemId}).from(claims).where(eq(claims.claimerId, fixture.ownerId)),
        exchange: await tx.select({budget: exchanges.budgetAmount}).from(exchanges).where(eq(exchanges.familyId, fixture.familyId)),
      }));
      expect(state.item[0].starred).toBe(false);
      expect(state.claims).toHaveLength(operation === "undo" ? 1 : 0);
      expect(state.exchange[0].budget).toBeNull();
      await test.info().attach("unchanged-persisted-state", {body: JSON.stringify(state, null, 2), contentType: "application/json"});
      if (operation === "acting-profile") {
        await page.goto(fixture.path);
        await expect(page.getByRole("button", {name: lists.claim, exact: true})).toHaveCount(0);
        await expect(page.getByRole("button", {name: lists.undoClaim, exact: true})).toHaveCount(0);
        await expect(page.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Tea tin"), exact: true})).toHaveCount(0);
        await shot(page, "helper-own-list-without-claims");
      }
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pool.end();
      await cleanup(fixture);
    }
  });
}

test("keeps a claimed gift title clear of its hanging tag at enlarged text size", async ({page}) => {
  const fixture = await setup(page);
  try {
    await database(fixture.familyId, (tx) => tx.update(items).set({title: "Sourdough baking book"})
      .where(eq(items.title, "Puzzle A")).execute());
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(`/en/lists/${fixture.relativeId}`);
    const gift = page.getByRole("article", {name: "Sourdough baking book", exact: true}).first();
    await gift.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(gift).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => { document.documentElement.style.zoom = "1.35"; });
    await page.waitForTimeout(1500);
    await shot(page, "large-text-claimed-title");
    const overlaps = await gift.evaluate((element) => {
      const tag = element.querySelector("[data-claim-tag]")!.getBoundingClientRect();
      const title = element.querySelector(".fge-claim-mine h2")!;
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const result: {letter: string; left: number; top: number; right: number; bottom: number}[] = [];
      let text: Node | null;
      while ((text = walker.nextNode())) {
        for (let index = 0; index < text.textContent!.length; index++) {
          if (!text.textContent![index].trim()) continue;
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.right > tag.left + 1 && rect.left < tag.right - 1 && rect.bottom > tag.top + 1 && rect.top < tag.bottom - 1) {
            result.push({letter: text.textContent![index], left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom});
          }
        }
      }
      return result;
    });
    await test.info().attach("title-tag-overlap", {body: JSON.stringify(overlaps, null, 2), contentType: "application/json"});
    expect(overlaps, "The hanging claim tag must not cover gift title letters").toEqual([]);
  } finally { await cleanup(fixture); }
});

test("keeps the active tab label legible after an edit sheet saves", async ({page}) => {
  const fixture = await setup(page);
  try {
    await page.goto(fixture.path);
    await page.waitForLoadState("networkidle");
    await (await edit(page)).getByRole("textbox", {name: lists.note, exact: true}).fill("Any color");
    await page.getByRole("dialog", {name: lists.editItem}).getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("dialog", {name: lists.editItem})).toBeHidden();
    await expect(card(page).getByText("Any color")).toBeVisible();
    await page.waitForTimeout(2000);
    await shot(page, "active-tab-after-edit-save", false);
    const geometry = await page.getByRole("navigation", {name: ui.tabs.label}).evaluate((bar) => {
      const active = bar.querySelector('[aria-current="page"]')!.getBoundingClientRect();
      const pill = bar.querySelector(".fge-tab-pill")!.getBoundingClientRect();
      return {active: {left: active.left, width: active.width}, pill: {left: pill.left, width: pill.width}};
    });
    await test.info().attach("active-tab-geometry", {body: JSON.stringify(geometry, null, 2), contentType: "application/json"});
    expect(Math.abs(geometry.active.left - geometry.pill.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.active.width - geometry.pill.width)).toBeLessThanOrEqual(1);
  } finally { await cleanup(fixture); }
});
