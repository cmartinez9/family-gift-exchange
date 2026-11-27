import {randomUUID} from "node:crypto";
import {expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {Client} from "pg";
import en from "../../messages/en.json" with {type: "json"};
import {connectDatabase, runForFamily, type FamilyTransaction} from "../../src/server/db/database";
import {exchanges, families, items, people} from "../../src/server/db/schema";

const {auth, lists, ui} = en;

async function database<T>(familyId: string, action: (tx: FamilyTransaction) => Promise<T>) {
  const connection = connectDatabase(process.env.DATABASE_URL!);
  try { return await runForFamily(connection.db, familyId, action); }
  finally { await connection.close(); }
}

async function setup(page: Page) {
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(`Snowfall ${randomUUID().slice(0, 6)}`);
  await page.getByLabel(auth.yourName).fill("Holly");
  await page.getByLabel(auth.pin, {exact: true}).fill("4268");
  await page.getByLabel(auth.confirmPin).fill("4268");
  await page.getByRole("button", {name: auth.createFamily}).click();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("link", {name: auth.sendKeys})).toBeVisible();
  const cookie = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!;
  const familyId = cookie.value.split(".")[0];
  return database(familyId, async (tx) => {
    const [owner] = await tx.select({id: people.id}).from(people).where(eq(people.familyId, familyId));
    const gifts = await tx.insert(items).values(["Tea tin", "Winter book", "Snow globe"].map((title, position) => ({
      familyId, ownerId: owner.id, kind: "note" as const, title, position,
    }))).returning({id: items.id});
    return {familyId, path: `/en/lists/${owner.id}`, gifts};
  });
}

async function edit(page: Page, title: string) {
  await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", title), exact: true}).click();
  return page.getByRole("dialog", {name: lists.editItem});
}

async function remove(page: Page, title: string) {
  await (await edit(page, title)).getByRole("button", {name: lists.deleteItem}).click();
  await expect(page.getByRole("article", {name: title, exact: true})).toHaveCount(0);
}

async function screenshot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({path: test.info().outputPath(`${name}.png`), fullPage: true});
}

for (const direction of ["up", "down"] as const) {
  test(`commits a pending removal before moving ${direction} past the visible neighbor`, async ({page}) => {
    const fixture = await setup(page);
    try {
      await page.goto(fixture.path);
      await remove(page, "Winter book");
      const sheet = await edit(page, direction === "up" ? "Snow globe" : "Tea tin");
      await expect(page.getByRole("button", {name: ui.undo, exact: true})).toBeVisible();
      await sheet.getByRole("button", {name: direction === "up" ? lists.moveUp : lists.moveDown}).click();
      await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Snow globe");
      await expect(page.getByRole("article").last()).toHaveAttribute("aria-label", "Tea tin");
      await expect(page.getByRole("article")).toHaveCount(2);
      const state = await database(fixture.familyId, (tx) => tx.select({title: items.title, archivedAt: items.archivedAt})
        .from(items).where(eq(items.id, fixture.gifts[1].id)));
      expect(state[0].archivedAt).not.toBeNull();
      await test.info().attach("removed-neighbor-state", {body: JSON.stringify(state), contentType: "application/json"});
      await screenshot(page, `pending-removal-move-${direction}`);
      await page.reload();
      await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Snow globe");
      await expect(page.getByRole("article")).toHaveCount(2);
    } finally {
      await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
    }
  });
}

test.describe("removal while another action is pending", () => {
  test.use({serviceWorkers: "block"});

  test("flushes a removal while a link save remains pending and the page reloads", async ({page}) => {
    const fixture = await setup(page);
    const holder = new Client({connectionString: process.env.DATABASE_URL!});
    let release!: () => void;
    try {
      await holder.connect();
      await page.goto(fixture.path);
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM items WHERE id = $1 FOR UPDATE", [fixture.gifts[0].id]);
      await remove(page, "Tea tin");
      await page.getByRole("button", {name: lists.addSomething}).click();
      await page.getByRole("dialog", {name: lists.addSomething}).getByRole("link", {name: new RegExp(lists.newLink)}).click();
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let first = true;
      await page.route("**/*", async (route) => {
        if (first && route.request().method() === "POST" && route.request().headers()["next-action"]) {
          first = false;
          entered();
          await gate;
        }
        await route.continue().catch(() => {});
      });
      await page.getByLabel(lists.url).fill("https://www.pololu.com/product/2133");
      await page.locator("form").filter({has: page.getByLabel(lists.url)}).evaluate((form: HTMLFormElement) => form.requestSubmit());
      await blocked;
      // The pending save holds the browser's action queue (the link preview is a plain request, so it no
      // longer can). The real removal must still reach PostgreSQL after its Undo timer, where this test
      // deliberately delays its commit.
      await expect.poll(async () => (await holder.query(
        "SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))",
      )).rows[0].count, {timeout: 10_000}).toBeGreaterThan(0);
      const reloading = page.reload();
      await holder.query("COMMIT");
      await reloading;
      release();
      await page.getByRole("link", {name: new RegExp(`${lists.myList}$`)}).click();
      await expect(page.getByRole("article", {name: "Tea tin", exact: true})).toHaveCount(0);
      await expect(page.getByRole("article", {name: "Winter book", exact: true})).toBeVisible();
      const state = await database(fixture.familyId, (tx) => tx.select({title: items.title, archivedAt: items.archivedAt})
        .from(items).where(eq(items.id, fixture.gifts[0].id)));
      expect(state[0].archivedAt).not.toBeNull();
      await test.info().attach("queued-preview-removal-state", {body: JSON.stringify(state), contentType: "application/json"});
      await screenshot(page, "removal-survived-pending-preview-and-reload");
    } finally {
      release?.();
      await holder.end();
      await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
    }
  });
});

test("uses the Chicago calendar for tomorrow, Today, and a past gift day on Home", async ({page}) => {
  const fixture = await setup(page);
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    await test.info().attach("calendar-observation", {
      body: JSON.stringify({instant: now.toISOString(), chicagoDay: today}), contentType: "application/json",
    });
    for (const offset of [1, 0, -1]) {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      await database(fixture.familyId, (tx) => tx.update(exchanges).set({giftDay: date.toISOString().slice(0, 10)})
        .where(eq(exchanges.familyId, fixture.familyId)).execute());
      await page.goto("/en");
      if (offset === -1) await expect(page.locator("[data-countdown]")).toHaveCount(0);
      else {
        await expect(page.locator("[data-countdown]")).toHaveAttribute("data-countdown", offset === 0 ? "today" : "1");
        await screenshot(page, offset === 0 ? "chicago-gift-day-today" : "chicago-tomorrow-one-day");
      }
    }
  } finally {
    await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
  }
});
