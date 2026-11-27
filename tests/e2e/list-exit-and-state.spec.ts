import {randomUUID} from "node:crypto";
import {expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {Client} from "pg";
import en from "../../messages/en.json" with {type: "json"};
import {connectDatabase, runForFamily, type FamilyTransaction} from "../../src/server/db/database";
import {families, items, people} from "../../src/server/db/schema";

const {auth, lists, homeScreen, ui} = en;

async function database<T>(familyId: string, action: (tx: FamilyTransaction) => Promise<T>) {
  const connection = connectDatabase(process.env.DATABASE_URL!);
  try { return await runForFamily(connection.db, familyId, action); }
  finally { await connection.close(); }
}

async function setup(page: Page) {
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(`Evergreen ${randomUUID().slice(0, 6)}`);
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
    const [relative] = await tx.insert(people).values({familyId, displayName: "Ivy"}).returning({id: people.id});
    const gifts = await tx.insert(items).values([
      {familyId, ownerId: owner.id, title: "Tea tin", kind: "note", position: 0},
      {familyId, ownerId: owner.id, title: "Winter book", kind: "note", position: 1},
      {familyId, ownerId: relative.id, title: "Puzzle", kind: "note", position: 0},
    ]).returning({id: items.id});
    return {familyId, path: `/en/lists/${owner.id}`, relativePath: `/en/lists/${relative.id}`, gifts};
  });
}

async function remove(page: Page, title: string) {
  await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", title), exact: true}).click();
  await page.getByRole("dialog", {name: lists.editItem}).getByRole("button", {name: lists.deleteItem}).click();
  await expect(page.getByRole("article", {name: title, exact: true})).toHaveCount(0);
}

for (const failure of ["writes", "access"] as const) {
  test(`dismisses and restores the install card across tab navigation when storage rejects ${failure}`, async ({page}) => {
    const fixture = await setup(page);
    try {
      await page.addInitScript((mode) => {
        if (mode === "access") Object.defineProperty(window, "localStorage", {get() { throw new DOMException("Blocked", "SecurityError"); }});
        else for (const method of ["setItem", "removeItem"]) Object.defineProperty(Storage.prototype, method, {
          value() { throw new DOMException("Full", "QuotaExceededError"); },
        });
      }, failure);
      await page.goto("/en");
      const install = page.getByRole("heading", {name: homeScreen.installTitle});
      await expect(install).toBeVisible();
      await page.getByRole("button", {name: homeScreen.installDismiss}).click();
      await expect(install).toHaveCount(0);
      const tabs = page.getByRole("navigation", {name: ui.tabs.label});
      await tabs.getByRole("link", {name: ui.tabs.family}).click();
      await tabs.getByRole("link", {name: ui.tabs.home}).click();
      await expect(install).toHaveCount(0);
      // Let the tab crossfade settle so the evidence shows the resulting Home screen.
      await page.waitForTimeout(700);
      await page.screenshot({path: test.info().outputPath(`storage-${failure}-dismissed.png`), fullPage: true});
      await page.getByRole("button", {name: ui.undo, exact: true}).click();
      await expect(install).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({path: test.info().outputPath(`storage-${failure}-undo.png`), fullPage: true});
    } finally {
      await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
    }
  });
}

for (const delayed of [false, true]) {
test(`does not redisplay a removed item when immediately reloading during Undo${delayed ? " with a delayed save" : ""}`, async ({page}) => {
  const fixture = await setup(page);
  const holder = delayed ? new Client({connectionString: process.env.DATABASE_URL!}) : null;
  try {
    await page.goto(fixture.path);
    await remove(page, "Tea tin");
    await expect(page.getByRole("button", {name: ui.undo, exact: true})).toBeVisible();
    await page.screenshot({path: test.info().outputPath("before-reload-removal-hidden.png"), fullPage: true});
    if (holder) {
      await holder.connect();
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM items WHERE id = $1 FOR UPDATE", [fixture.gifts[0].id]);
    }
    const reloading = page.reload();
    if (holder) {
      await expect.poll(async () => (await holder.query(
        "SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))",
      )).rows[0].count).toBeGreaterThan(0);
      await holder.query("COMMIT");
    }
    await reloading;
    await expect.poll(() => database(fixture.familyId, async (tx) => {
      const [item] = await tx.select({archivedAt: items.archivedAt}).from(items).where(eq(items.id, fixture.gifts[0].id));
      return item.archivedAt !== null;
    })).toBe(true);
    await page.waitForLoadState("networkidle");
    const state = await database(fixture.familyId, (tx) => tx.select({title: items.title, archivedAt: items.archivedAt})
      .from(items).where(eq(items.id, fixture.gifts[0].id)));
    expect(state[0].archivedAt).not.toBeNull();
    await test.info().attach("reloaded-removal-state", {body: JSON.stringify(state, null, 2), contentType: "application/json"});
    await page.screenshot({path: test.info().outputPath("reload-does-not-restore-removal.png"), fullPage: true});
    await expect(page.getByRole("article", {name: "Tea tin", exact: true})).toHaveCount(0);
    await expect(page.getByRole("article", {name: "Winter book", exact: true})).toBeVisible();
  } finally {
    await holder?.end();
    await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
  }
});
}

test("flushes all pending removals when closing the page before Undo expires", async ({page}) => {
  const fixture = await setup(page);
  const opened = page.waitForEvent("popup");
  await page.evaluate((path) => { window.open(path); }, fixture.path);
  const closing = await opened;
  try {
    await remove(closing, "Tea tin");
    await remove(closing, "Winter book");
    await expect(closing.getByRole("button", {name: ui.undo, exact: true})).toBeVisible();
    await closing.screenshot({path: test.info().outputPath("before-close-removals-hidden.png"), fullPage: true});
    const closed = closing.waitForEvent("close");
    await closing.evaluate(() => window.close());
    await closed;
    try {
      await expect.poll(() => database(fixture.familyId, (tx) => tx.select({archivedAt: items.archivedAt})
        .from(items).where(eq(items.ownerId, fixture.path.split("/").at(-1)!))
        .then((rows) => rows.filter(({archivedAt}) => archivedAt !== null).length))).toBe(2);
    } finally {
      const state = await database(fixture.familyId, (tx) => tx.select({title: items.title, archivedAt: items.archivedAt})
        .from(items).where(eq(items.ownerId, fixture.path.split("/").at(-1)!)));
      await test.info().attach("closed-page-removal-state", {body: JSON.stringify(state, null, 2), contentType: "application/json"});
      await page.goto(fixture.path);
      await page.screenshot({path: test.info().outputPath("closed-page-removals-persisted.png"), fullPage: true});
    }
    await expect(page.getByRole("heading", {name: lists.emptyTitle})).toBeVisible();
  } finally {
    await closing.close();
    await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
  }
});

test("rejects cross-origin and non-owner removal requests without archiving either item", async ({page}) => {
  const fixture = await setup(page);
  try {
    const deniedOrigin = await page.request.post(`${fixture.path}/items/${fixture.gifts[0].id}/remove`, {
      headers: {origin: "https://unrelated.example"},
    });
    expect(deniedOrigin.status()).toBe(403);
    const deniedMember = await page.request.post(`${fixture.relativePath}/items/${fixture.gifts[2].id}/remove`, {
      headers: {origin: new URL(page.url()).origin},
    });
    expect(await deniedMember.json()).toEqual({error: "forbidden"});
    const state = await database(fixture.familyId, (tx) => tx.select({title: items.title, archivedAt: items.archivedAt})
      .from(items).where(eq(items.familyId, fixture.familyId)));
    expect(state).toHaveLength(3);
    expect(state.every(({archivedAt}) => archivedAt === null)).toBe(true);
    await test.info().attach("removal-authorization", {
      body: JSON.stringify({crossOrigin: {status: deniedOrigin.status(), body: await deniedOrigin.json()},
        nonOwner: await deniedMember.json(), persistedItems: state}, null, 2), contentType: "application/json",
    });
    await page.goto(fixture.relativePath);
    await expect(page.getByRole("article", {name: "Puzzle", exact: true})).toBeVisible();
    await page.screenshot({path: test.info().outputPath("non-owner-item-preserved.png"), fullPage: true});
  } finally {
    await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
  }
});

for (const field of ["bought", "wrapped"] as const) {
  test(`reconciles ${field} after a stale tab clears it and another checklist save refreshes the page`, async ({page}) => {
    const fixture = await setup(page);
    const other = await page.context().newPage();
    try {
      await page.goto(fixture.relativePath);
      await page.getByRole("button", {name: lists.claim, exact: true}).click();
      await expect(page.getByRole("article")).toHaveAttribute("aria-busy", "false");
      await page.goto("/en/lists/getting");
      const checkbox = page.getByLabel(lists[field], {exact: true});
      await checkbox.check();
      await expect(checkbox).toBeEnabled();
      await other.goto("/en/lists/getting");
      await expect(other.getByLabel(lists[field], {exact: true})).toBeChecked();
      await checkbox.uncheck();
      await expect(checkbox).toBeEnabled();
      await checkbox.check();
      await expect(checkbox).toBeEnabled();
      await other.getByLabel(lists[field], {exact: true}).uncheck();
      await expect(other.getByLabel(lists[field], {exact: true})).toBeEnabled();
      await page.getByLabel(lists[field === "bought" ? "wrapped" : "bought"], {exact: true}).check();
      await expect(page.getByLabel(lists[field === "bought" ? "wrapped" : "bought"], {exact: true})).toBeEnabled();
      await expect(checkbox).not.toBeChecked();
      await page.screenshot({path: test.info().outputPath(`${field}-cross-tab-reconciled.png`), fullPage: true});
      await page.reload();
      await expect(checkbox).not.toBeChecked();
    } finally {
      await other.close();
      await database(fixture.familyId, (tx) => tx.delete(families).where(eq(families.id, fixture.familyId)).execute());
    }
  });
}
