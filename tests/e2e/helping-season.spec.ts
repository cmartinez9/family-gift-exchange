import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContextOptions, type Page} from "@playwright/test";
import {eq, sql} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {claims, exchanges, families, items, outbox, participants, people} from "../../src/server/db/schema";
import {issueKey} from "../../src/server/auth/access";
import {pinCredentials} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {assignments, drawRuleSnapshots, practiceFamilies} from "../../src/server/draw/schema";
import {drawSeal, sealText} from "../../src/server/draw/sealing";
import {requireIssuedKey} from "../helpers/issued-key";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

// The helping, notices, family-chat and end-of-season screens at 390 by 844, in English and Spanish,
// at the largest text size and with reduced motion. E2E_EVIDENCE_DIR overrides test-results/design/.
const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true} satisfies BrowserContextOptions;
// The largest text size: the browser at 200%, so the 390px phone lays out at 195 CSS pixels.
const largest = {...phone, viewport: {width: 195, height: 422}, deviceScaleFactor: 6} satisfies BrowserContextOptions;
const names = ["Christian", "Rosa", "Tito", "Ana", "Beto", "Leo", "Marta"] as const;

async function family(browser: Browser) {
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  const familyId = randomUUID();
  const exchangeId = randomUUID();
  const ids = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<(typeof names)[number], string>;
  const playing = [ids.Christian, ids.Rosa, ids.Ana, ids.Tito, ids.Beto, ids.Leo];
  const next = new Map(playing.map((id, index) => [id, playing[(index + 1) % playing.length]]));
  const key = Buffer.from(process.env.E2E_ASSIGNMENT_ENCRYPTION_KEY!, "base64");
  const pinHash = await hashPin(process.env.E2E_AUTH_SECRET!, "4268");
  const joinedAt = new Date(Date.now() - 7 * 86_400_000);
  const helpers: Partial<Record<string, string>> = {[ids.Tito]: ids.Rosa, [ids.Leo]: ids.Ana};
  await database.db.insert(families).values({id: familyId, name: `Martinez family ${familyId.slice(0, 4)}`});
  await database.db.insert(people).values(names.map((name) => ({familyId, id: ids[name], displayName: name,
    role: name === "Christian" ? "organizer" as const : "member" as const})));
  for (const [personId, helperId] of Object.entries(helpers)) {
    await runForFamily(database.db, familyId, (tx) => tx.update(people).set({helperId}).where(eq(people.id, personId)));
  }
  // Tito and Leo are looked after and Marta has not opened her key yet, so none of them has a PIN.
  await database.db.insert(pinCredentials).values([ids.Christian, ids.Rosa, ids.Ana, ids.Beto]
    .map((personId) => ({familyId, personId, pinHash, joinedAt, changedAt: joinedAt})));
  await database.db.insert(exchanges).values({familyId, id: exchangeId, name: "Christmas 2026", giftDay: "2026-12-24",
    giftTime: "19:00", place: "Ana's house", budgetAmount: "50", status: "drawn", drawVersion: 1,
    seal: drawSeal(key, familyId, exchangeId, 1, next)});
  await database.db.insert(participants).values(playing.map((personId) => ({familyId, exchangeId, personId, status: "in" as const})));
  await database.db.insert(drawRuleSnapshots).values({familyId, exchangeId,
    roster: playing.map((id) => ({id, helperId: helpers[id] ?? null, householdId: null})), keepApart: []});
  await database.db.insert(assignments).values(playing.map((giverId) => ({familyId, exchangeId, giverId, version: 1,
    recipientSealed: sealText(key, {familyId, exchangeId, giverId, version: 1, field: "assignment"}, next.get(giverId)!)})));
  const day = (date: string) => new Date(`${date}T18:00:00Z`);
  await database.db.insert(outbox).values([
    {template: "budget-changed", createdAt: day("2026-12-11"), readAt: null},
    {template: "names-drawn", createdAt: day("2026-11-29"), readAt: null},
    {template: "list-reminder", createdAt: day("2026-12-04"), readAt: day("2026-12-04")},
    {template: "claimed-item-changed", createdAt: day("2026-12-03"), readAt: day("2026-12-03")},
  ].map((notice) => ({...notice, familyId, personId: ids.Rosa, channel: "push" as const, language: "en" as const, status: "captured" as const})));

  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  async function signedIn(name: (typeof names)[number], options: BrowserContextOptions = phone) {
    const token = secret();
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids[name], digest(token), "iphone", new Date()));
    const context = await browser.newContext(options);
    contexts.push(context);
    await context.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-family", value: familyId, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    return context.newPage();
  }
  async function guest(options: BrowserContextOptions = phone) {
    const context = await browser.newContext(options);
    contexts.push(context);
    return context.newPage();
  }
  async function martaKey() {
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids.Christian, digest(secret()), "iphone", new Date()));
    const organizer = {familyId, personId: ids.Christian, actingAs: ids.Christian, sessionId: session.id, isOrganizer: true};
    const issued = requireIssuedKey(await runForFamily(database.db, familyId, (tx) =>
      issueKey(tx, organizer, ids.Marta, "share", process.env.E2E_AUTH_SECRET!, new Date())));
    return `${familyId}~${issued.token}`;
  }
  return {familyId, exchangeId, ids, signedIn, guest, martaKey, async close() {
    await Promise.allSettled(contexts.map((context) => context.close()));
    const practice = await database.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, familyId));
    await database.db.delete(families).where(eq(families.id, familyId));
    for (const row of practice) await database.db.delete(families).where(eq(families.id, row.practiceFamilyId));
    await database.close();
  }};
}

/** Waits for arrivals and sheets to settle, checks the screen for overflow and axe, then saves it. */
async function shot(page: Page, name: string, {axe = true, scope = "body", scale = "device"}: {
  axe?: boolean; scope?: string; scale?: "css" | "device";
} = {}) {
  await page.waitForLoadState("networkidle");
  // `next dev` adds its own indicator; production builds have none.
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"
    || (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity));
  // Anything wider than the screen, or text that spills out of its own box.
  const overflow = await page.locator(scope).evaluate((root) => [...root.querySelectorAll("*")]
    .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5
      || (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 && getComputedStyle(element).overflowX === "visible"))
    .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(0, 120)));
  expect(overflow, "nothing runs off the screen").toEqual([]);
  if (axe) expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  const folder = join(process.env.E2E_EVIDENCE_DIR ?? join(process.cwd(), "test-results", "design"), test.info().project.name);
  mkdirSync(folder, {recursive: true});
  await page.screenshot({path: join(folder, `${name}.png`), scale});
}

for (const exit of ["navigation", "Done", "home"] as const) {
  test(`clears helping mode after remote session revocation and ${exit}`, async ({browser}) => {
    const f = await family(browser);
    try {
      const helping = await f.signedIn("Rosa");
      const otherDevice = await f.signedIn("Rosa");
      await helping.goto("/en/account");
      await helping.getByRole("button", {name: "Help Tito", exact: true}).click();
      await expect(helping).toHaveURL(/\/en\/helping$/);
      await expect(helping.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Tito");
      if (exit === "home") {
        await helping.goto(`/en/key/${await f.martaKey()}`);
        await expect(helping.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Tito");
      }

      await otherDevice.goto("/en/account/phones");
      await otherDevice.getByRole("button", {name: "Sign out everywhere", exact: true}).click();
      await otherDevice.getByRole("dialog").getByRole("button", {name: "Sign out everywhere", exact: true}).click();
      await expect(otherDevice).toHaveURL(/\/en\/sign-in$/);

      if (exit === "navigation") await helping.getByRole("link", {name: "Later", exact: true}).click();
      else if (exit === "Done") await helping.getByRole("button", {name: "Done", exact: true}).click();
      else await helping.getByRole("link", {name: "Back to Rosa's Home", exact: true}).click();
      await expect(helping).toHaveURL(exit === "home" ? /\/en$/ : /\/en\/sign-in$/);
      await expect(helping.getByRole("button", {name: en.auth.signInFaceId, exact: true})).toBeVisible();
      await expect(helping.getByRole("region", {name: "Helping mode"})).toHaveCount(0);
      await shot(helping, `revoked-helping-${exit}`);
    } finally {
      await f.close();
    }
  });
}

test("refreshes shared helping context when a tab regains focus or visibility", async ({browser}) => {
  const f = await family(browser);
  try {
    const helping = await f.signedIn("Rosa");
    await helping.goto("/en/account");
    await helping.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(helping).toHaveURL(/\/en\/helping$/);
    await helping.goto("/en/account");
    await expect(helping.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Tito");
    const other = await helping.context().newPage();
    await other.goto("/en/account");
    await other.bringToFront();
    await other.getByRole("button", {name: "Done", exact: true}).click();
    // Done returns to the same URL. Rosa can help Tito again once the switch has committed.
    await expect(other.getByRole("button", {name: "Help Tito", exact: true})).toBeVisible();
    await expect(other).toHaveURL(/\/en\/account$/);

    await helping.bringToFront();
    await helping.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(helping.getByRole("region", {name: "Helping mode"})).toHaveCount(0);
    await expect(helping.locator('a[href$="/account/notices"]')).toContainText("2 new");
    await helping.goto("/en/notifications");
    await expect(helping.getByRole("heading", {name: "Notices", exact: true})).toBeVisible();
    await expect(helping.locator('[data-notice="unread"]')).toHaveCount(2);

    await other.bringToFront();
    await other.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(other).toHaveURL(/\/en\/helping$/);
    await helping.bringToFront();
    await helping.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(helping.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Tito");
    await expect(helping.locator("[data-notice]")).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("rejects stale claim actions after another tab switches the acting profile", async ({browser}) => {
  test.setTimeout(60_000);
  const f = await family(browser);
  try {
    const owner = await f.signedIn("Ana");
    await owner.goto(`/en/lists/${f.ids.Ana}/items/new?kind=note`);
    await owner.getByLabel(en.lists.title, {exact: true}).fill("Warm mittens");
    await owner.getByRole("button", {name: en.lists.saveItem, exact: true}).click();
    await expect(owner.getByRole("article", {name: "Warm mittens"})).toBeVisible();

    const rosa = await f.signedIn("Rosa");
    const switcher = await rosa.context().newPage();
    await rosa.goto(`/en/lists/${f.ids.Ana}`);
    await switcher.goto("/en/account");
    await switcher.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(switcher).toHaveURL(/\/en\/helping$/);
    await rosa.getByRole("button", {name: "I’m getting this", exact: true}).click();
    await expect(rosa.locator(".fge-toast")).toHaveText(en.lists.feedback.forbidden);
    await shot(rosa, "stale-claim-rejected", {axe: false});

    await rosa.reload();
    await expect(rosa.getByRole("button", {name: "I’m getting this", exact: true})).toBeVisible();
    await rosa.getByRole("button", {name: "I’m getting this", exact: true}).click();
    await expect(rosa.getByText("You’re getting this", {exact: true})).toBeVisible();
    const reserved = await rosa.context().newPage();
    await reserved.goto(`/en/lists/${f.ids.Ana}`);
    await expect(reserved.getByRole("button", {name: en.lists.undoClaim, exact: true})).toBeVisible();
    await rosa.goto("/en/lists/getting");
    await rosa.getByRole("checkbox", {name: "Bought", exact: true}).check();
    await expect(rosa.getByRole("checkbox", {name: "Bought", exact: true})).toBeEnabled();
    await rosa.getByRole("checkbox", {name: "Wrapped", exact: true}).check();
    await expect(rosa.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeEnabled();
    await rosa.reload();
    await expect(rosa.getByRole("checkbox", {name: "Bought", exact: true})).toBeChecked();
    await expect(rosa.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeChecked();

    await switcher.getByRole("button", {name: "Done", exact: true}).click();
    await expect(switcher).toHaveURL(/\/en\/account$/);
    await reserved.getByRole("button", {name: en.lists.undoClaim, exact: true}).click();
    await expect(reserved.locator(".fge-toast")).toHaveText(en.lists.feedback.forbidden);
    for (const [index, name] of ["Bought", "Wrapped"].entries()) {
      const tick = rosa.getByRole("checkbox", {name, exact: true});
      // Rejection restores the check, so uncheck()'s unchecked postcondition would race it.
      await tick.click();
      await expect(rosa.getByRole("main").getByRole("alert")).toHaveCount(index + 1);
      await expect(tick).toBeChecked();
    }
    await expect(rosa.getByRole("main").getByRole("alert")).toHaveText(["You can’t make this change.", "You can’t make this change."]);
    await switcher.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(switcher).toHaveURL(/\/en\/helping$/);
    await rosa.reload();
    await expect(rosa.getByRole("checkbox", {name: "Bought", exact: true})).toBeChecked();
    await expect(rosa.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeChecked();
  } finally {
    await f.close();
  }
});

test("the notice badge reaches zero after reading the newest 100 while an older unread notice stays stored", async ({browser}) => {
  test.setTimeout(120_000);
  const f = await family(browser);
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  try {
    await database.db.delete(outbox).where(eq(outbox.familyId, f.familyId));
    const ids = Array.from({length: 101}, () => randomUUID()).toSorted().reverse();
    await database.db.insert(outbox).values(ids.map((id) => ({id, familyId: f.familyId, personId: f.ids.Rosa,
      channel: "push" as const, language: "en" as const, template: "names-drawn", status: "captured" as const,
      createdAt: new Date("2026-11-25T18:00:00Z")})));
    const rosa = await f.signedIn("Rosa");
    await rosa.goto("/en/account");
    await expect(rosa.locator('a[href$="/account/notices"]')).toContainText("100 new");
    await rosa.goto("/en/notifications");
    await expect(rosa.locator('[data-notice="unread"]')).toHaveCount(100);
    for (let remaining = 100; remaining > 0; remaining--) {
      await rosa.getByRole("button", {name: "Mark as read", exact: true}).first().click();
      await expect(rosa.locator('[data-notice="unread"]')).toHaveCount(remaining - 1);
      // WebKit limits history updates to 100 per ten seconds; pace this synthetic 100-tap loop.
      await rosa.waitForTimeout(150);
    }
    await expect(rosa.locator('[data-notice="read"]')).toHaveCount(100);
    await shot(rosa, "newest-100-notices-all-read");
    await rosa.goto("/en/account");
    await expect(rosa.locator('a[href$="/account/notices"]')).toBeVisible();
    await expect(rosa.locator('a[href$="/account/notices"]')).not.toContainText(/\d+ new/);
    const stored = await database.db.select().from(outbox).where(eq(outbox.familyId, f.familyId));
    expect(stored).toHaveLength(101);
    expect(stored.filter(({readAt}) => readAt === null).map(({id}) => id)).toEqual([ids[100]]);
    await shot(rosa, "newest-100-zero-badge", {axe: false});
    await test.info().attach("retained-notice-state", {body: JSON.stringify({stored: stored.length,
      read: stored.filter(({readAt}) => readAt !== null).length, olderUnreadRetained: true}), contentType: "application/json"});
  } finally {
    await database.close();
    await f.close();
  }
});

for (const locale of ["en", "es"] as const) {
  test(`confirms season close before clearing gift marks and checklist entries (${locale})`, async ({browser}) => {
    const f = await family(browser);
    const {draw, lists, season} = locale === "en" ? en : es;
    const title = "Warm mittens";
    const reducedMotion = "reduce" as const;
    try {
      const owner = await f.signedIn("Ana");
      const ownerList = `/${locale}/lists/${f.ids.Ana}`;
      await owner.goto(`${ownerList}/items/new?kind=note`);
      await owner.getByLabel(lists.title, {exact: true}).fill(title);
      await owner.getByRole("button", {name: lists.saveItem, exact: true}).click();
      const item = owner.getByRole("article", {name: title});
      await expect(item).toBeVisible();

      const buyer = await f.signedIn("Rosa");
      await buyer.goto(ownerList);
      await buyer.getByRole("button", {name: lists.claim, exact: true}).click();
      await expect(buyer.getByText(lists.mine, {exact: true})).toBeVisible();
      await buyer.goto(`/${locale}/lists/getting`);
      const entry = buyer.getByRole("heading", {name: title, exact: true});
      await expect(entry).toBeVisible();
      for (const label of [lists.bought, lists.wrapped]) {
        const tick = buyer.getByRole("checkbox", {name: label, exact: true});
        await tick.check();
        await expect(tick).toBeEnabled();
        await expect(tick).toBeChecked();
      }
      await shot(buyer, `close-checklist-before-${locale}`, {axe: false});

      const closing = await f.signedIn("Christian", {...phone, reducedMotion});
      const zoomed = await f.signedIn("Christian", {...largest, deviceScaleFactor: 2, reducedMotion});
      const management = `/${locale}/exchanges/${f.exchangeId}/manage`;
      const confirm = season.closeConfirm.replace("{name}", "Christmas 2026");
      for (const [label, page] of [["390x844", closing], ["200-percent", zoomed]] as const) {
        await page.goto(management);
        await page.getByRole("button", {name: draw.close, exact: true}).click();
        const dialog = page.getByRole("dialog", {name: season.closeTitle.replace("{name}", "Christmas 2026")});
        const marks = dialog.getByText(season.closeMarks, {exact: true});
        await expect(marks).toBeVisible();
        await expect(dialog.getByRole("button", {name: confirm, exact: true})).toBeEnabled();
        if (label === "200-percent") {
          await marks.scrollIntoViewIfNeeded();
          await expect(marks).toBeInViewport();
        }
        await shot(page, `f12-12_2-close-marks-${locale}-${label}`, {
          scope: "dialog[open]", scale: label === "390x844" ? "css" : "device",
        });
        await dialog.getByRole("button", {name: season.notYet, exact: true}).click();
        await expect(dialog).toBeHidden();
      }
      await buyer.reload();
      await expect(entry).toBeVisible();
      await expect(buyer.getByRole("checkbox", {name: lists.bought, exact: true})).toBeChecked();
      await expect(buyer.getByRole("checkbox", {name: lists.wrapped, exact: true})).toBeChecked();

      await closing.getByRole("button", {name: draw.close, exact: true}).click();
      await closing.getByRole("dialog").getByRole("button", {name: confirm, exact: true}).click();
      await expect(closing.getByRole("heading", {name: season.wrapTitle, exact: true})).toBeVisible();
      await shot(closing, `close-wrap-${locale}`, {axe: false});

      await buyer.reload();
      await expect(buyer.getByText(lists.emptyGetting, {exact: true})).toBeVisible();
      await expect(entry).toHaveCount(0);
      await shot(buyer, `close-checklist-cleared-${locale}`, {axe: false});
      await buyer.goto(ownerList);
      await expect(buyer.getByRole("article", {name: title}).getByRole("button", {name: lists.claim, exact: true})).toBeVisible();
      await owner.reload();
      await expect(item).toBeVisible();
      await shot(owner, `close-wishlist-retained-${locale}`, {axe: false});
    } finally {
      await f.close();
    }
  });

  for (const value of ["50", "75"]) {
    test(`rejects a stale ${value} budget after closing the exchange in ${locale}`, async ({browser}) => {
      const f = await family(browser);
      const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
      try {
        const organizer = await f.signedIn("Christian");
        const closing = await organizer.context().newPage();
        await organizer.goto(`/${locale}/lists`);
        await organizer.locator('input[name="budget"]').fill(value);
        await closing.goto(`/en/exchanges/${f.exchangeId}/manage`);
        await closing.getByRole("button", {name: "Close exchange", exact: true}).click();
        // Let the sheet finish rising before tapping its cancel control in WebKit.
        await closing.getByRole("dialog").evaluate(async (dialog) => {
          await Promise.all(dialog.getAnimations({subtree: true}).map((animation) => animation.finished));
        });
        await closing.getByRole("button", {name: "Not yet", exact: true}).click();
        await expect(closing.getByRole("dialog")).toBeHidden();
        const [stillOpen] = await database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId));
        expect(stillOpen.status).toBe("drawn");
        await closing.getByRole("button", {name: "Close exchange", exact: true}).click();
        await closing.getByRole("button", {name: "Close Christmas 2026", exact: true}).click();
        await expect(closing.getByRole("heading", {name: "That's a wrap", exact: true})).toBeVisible();
        await organizer.locator('form').filter({has: organizer.locator('input[name="budget"]')}).getByRole("button").click();
        await expect(organizer.getByRole("main").getByRole("alert")).toHaveText((locale === "en" ? en : es).lists.feedback.closed);
        const [closed] = await database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId));
        expect(closed).toMatchObject({status: "closed", budgetAmount: "50.00"});
        const notices = await database.db.select().from(outbox).where(eq(outbox.familyId, f.familyId));
        expect(notices.filter(({template}) => template === "budget-changed")).toHaveLength(1);
        await shot(organizer, `closed-budget-rejected-${locale}-${value}`, {axe: false});
      } finally {
        await database.close();
        await f.close();
      }
    });
  }
}

async function addClosingGift(page: Page, ownerId: string, title: string) {
  await page.goto(`/en/lists/${ownerId}/items/new?kind=note`);
  await page.getByLabel(en.lists.title, {exact: true}).fill(title);
  await page.getByRole("button", {name: en.lists.saveItem, exact: true}).click();
  await expect(page.getByRole("article", {name: title})).toBeVisible();
}

async function markClosingGift(page: Page, ownerId: string) {
  await page.goto(`/en/lists/${ownerId}`);
  await page.getByRole("button", {name: en.lists.claim, exact: true}).click();
  await expect(page.getByText(en.lists.mine, {exact: true})).toBeVisible();
  // The claimed label is optimistic; wait for the save before leaving the page.
  await expect(page.getByRole("button", {name: en.lists.undoClaim, exact: true})).toBeEnabled();
  await page.goto("/en/lists/getting");
  for (const name of [en.lists.bought, en.lists.wrapped]) {
    const tick = page.getByRole("checkbox", {name, exact: true});
    await expect(tick).not.toBeChecked();
    await tick.check();
    await expect(tick).toBeEnabled();
    await expect(tick).toBeChecked();
  }
}

async function prepareClosingSheet(page: Page, exchangeId: string) {
  await page.goto(`/en/exchanges/${exchangeId}/manage`);
  await page.getByRole("button", {name: en.draw.close, exact: true}).click();
  return page.getByRole("dialog").getByRole("button", {name: "Close Christmas 2026", exact: true});
}

function closingEvidence(label: string, state: unknown) {
  const folder = join(process.env.E2E_EVIDENCE_DIR ?? "test-results", test.info().project.name);
  mkdirSync(folder, {recursive: true});
  writeFileSync(join(folder, `${label}.json`), JSON.stringify(state, null, 2));
}

for (const status of ["setup", "open"] as const) {
  test(`clears pre-draw ${status} and legacy marks after drawing while retaining lists and another family's checklist`, async ({browser}) => {
    test.setTimeout(90_000);
    const f = await family(browser);
    const foreign = await family(browser);
    const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
    try {
      await database.db.delete(assignments).where(eq(assignments.familyId, f.familyId));
      await database.db.delete(drawRuleSnapshots).where(eq(drawRuleSnapshots.familyId, f.familyId));
      await database.db.update(exchanges).set({status, drawVersion: 0, seal: null}).where(eq(exchanges.id, f.exchangeId));
      const oldExchangeId = randomUUID();
      await database.db.insert(exchanges).values({familyId: f.familyId, id: oldExchangeId, name: "Prior year", status: "closed"});
      const legacyItems = [randomUUID(), randomUUID()];
      await database.db.insert(items).values(legacyItems.map((id, index) => ({
        familyId: f.familyId, id, ownerId: f.ids.Ana, kind: "note" as const, title: `Legacy gift ${index + 1}`,
      })));
      await database.db.insert(claims).values(legacyItems.map((itemId, index) => ({
        familyId: f.familyId, itemId, claimerId: f.ids.Beto, exchangeId: index ? oldExchangeId : null,
        boughtAt: new Date(), wrappedAt: new Date(),
      })));
      const [foreignItem] = await database.db.insert(items).values({familyId: foreign.familyId,
        ownerId: foreign.ids.Ana, kind: "note", title: "Other family's scarf"}).returning();
      await database.db.insert(claims).values({familyId: foreign.familyId, itemId: foreignItem.id,
        claimerId: foreign.ids.Rosa, boughtAt: new Date(), wrappedAt: new Date()});
      const foreignRows = () => database.db.select().from(claims).where(eq(claims.familyId, foreign.familyId));
      const savedForeign = await foreignRows();
      const foreignBuyer = await foreign.signedIn("Rosa");
      await foreignBuyer.goto("/en/lists/getting");
      await expect(foreignBuyer.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeChecked();

      const owner = await f.signedIn("Ana");
      await addClosingGift(owner, f.ids.Ana, "Setup winter hat");
      const buyer = await f.signedIn("Rosa");
      await markClosingGift(buyer, f.ids.Ana);
      await shot(buyer, `pre-draw-${status}-checklist`, {axe: false});
      const savedItems = await database.db.select().from(items).where(eq(items.familyId, f.familyId)).orderBy(items.id);
      const initialClaims = await database.db.select().from(claims).where(eq(claims.familyId, f.familyId));
      expect(initialClaims).toHaveLength(3);
      expect(initialClaims.every(({boughtAt, wrappedAt}) => boughtAt && wrappedAt)).toBe(true);

      const organizer = await f.signedIn("Christian");
      await organizer.goto(`/en/exchanges/${f.exchangeId}/manage`);
      if (status === "setup") {
        await organizer.getByRole("button", {name: en.draw.setup.nextPeople, exact: true}).click();
        await expect(organizer.getByLabel(en.draw.name, {exact: true})).toBeHidden();
      }
      await organizer.goto(`/en/exchanges/${f.exchangeId}/manage/draw`);
      await organizer.getByRole("button", {name: en.draw.drawNames, exact: true}).click();
      await expect(organizer.getByRole("heading", {name: en.draw.setup.sealedTitle, exact: true})).toBeVisible({timeout: 15_000});
      await expect(organizer.getByText(/^Seal code /)).toBeVisible();
      const [drawn] = await database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId));
      await buyer.goto(`/en/exchanges/${f.exchangeId}`);
      await buyer.getByRole("button", {name: en.draw.person.revealTap, exact: true}).tap();
      await buyer.getByRole("button", {name: /^See .+’s page$/}).click();
      await expect(buyer.getByRole("heading", {level: 1, name: /^You’re giving to /})).toBeVisible();
      await buyer.getByRole("button", {name: /^Ask .+ (a question|for ideas)$/}).first().click();
      await buyer.getByLabel("Your anonymous question").fill("Any favorite winter colors?");
      await buyer.getByRole("button", {name: en.draw.askButton, exact: true}).click();
      await expect(buyer.getByText(en.draw.person.sentHint, {exact: true})).toBeVisible();
      const beforeCounts = (await database.db.execute(sql`SELECT
        (SELECT count(*)::int FROM assignments WHERE family_id = ${f.familyId}::uuid) AS assignments,
        (SELECT count(*)::int FROM questions WHERE family_id = ${f.familyId}::uuid) AS questions`)).rows;
      expect(beforeCounts).toEqual([{assignments: 6, questions: 1}]);
      await (await prepareClosingSheet(organizer, f.exchangeId)).click();
      await expect(organizer.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      const remaining = await database.db.select().from(claims).where(eq(claims.familyId, f.familyId));
      expect(remaining).toEqual([]);
      expect(await database.db.select().from(items).where(eq(items.familyId, f.familyId)).orderBy(items.id)).toEqual(savedItems);
      expect(await foreignRows()).toEqual(savedForeign);
      const [closed] = await database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId));
      expect(closed).toMatchObject({status: "closed", seal: drawn.seal, budgetAmount: drawn.budgetAmount, giftDay: drawn.giftDay});
      const afterCounts = (await database.db.execute(sql`SELECT
        (SELECT count(*)::int FROM assignments WHERE family_id = ${f.familyId}::uuid) AS assignments,
        (SELECT count(*)::int FROM questions WHERE family_id = ${f.familyId}::uuid) AS questions`)).rows;
      expect(afterCounts).toEqual([{assignments: 0, questions: 0}]);
      closingEvidence(`pre-draw-${status}-persisted-state`, {initialClaims, remaining, retainedItemTitles: savedItems.map(({title}) => title),
        foreignBefore: savedForeign, foreignAfter: await foreignRows(), beforeCounts, afterCounts, drawn, closed});
      await buyer.goto("/en/lists/getting");
      await expect(buyer.getByText(en.lists.emptyGetting, {exact: true})).toBeVisible();
      await shot(buyer, `pre-draw-${status}-cleared`, {axe: false});
      await buyer.goto(`/en/lists/${f.ids.Ana}`);
      await expect(buyer.getByRole("button", {name: en.lists.claim, exact: true})).toHaveCount(3);
      await shot(buyer, `pre-draw-${status}-wishlist-retained`, {axe: false});
      await foreignBuyer.reload();
      await expect(foreignBuyer.getByRole("checkbox", {name: "Bought", exact: true})).toBeChecked();
      await expect(foreignBuyer.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeChecked();
      await shot(foreignBuyer, `pre-draw-${status}-other-family-retained`, {axe: false});
    } finally {
      await database.close();
      await f.close();
      await foreign.close();
    }
  });
}

for (const nextSeason of [false, true]) {
  test(`a stale close confirmation preserves later marks ${nextSeason ? "during the next season" : "between seasons"}`, async ({browser}) => {
    test.setTimeout(60_000);
    const f = await family(browser);
    const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
    try {
      await database.db.update(people).set({role: "co_organizer"}).where(eq(people.id, f.ids.Beto));
      const owner = await f.signedIn("Ana");
      await addClosingGift(owner, f.ids.Ana, "Gift for next time");
      const buyer = await f.signedIn("Rosa");
      await markClosingGift(buyer, f.ids.Ana);
      const organizer = await f.signedIn("Christian");
      const coOrganizer = await f.signedIn("Beto");
      const first = await prepareClosingSheet(organizer, f.exchangeId);
      const stale = await prepareClosingSheet(coOrganizer, f.exchangeId);
      await first.click();
      await expect(organizer.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      await buyer.reload();
      await expect(buyer.getByText(en.lists.emptyGetting, {exact: true})).toBeVisible();
      if (nextSeason) {
        await organizer.goto("/en/exchanges/new");
        await organizer.getByLabel(en.draw.name, {exact: true}).fill("Christmas 2027");
        await organizer.getByRole("button", {name: en.draw.setup.nextPeople, exact: true}).click();
        await expect(organizer.getByRole("heading", {name: en.draw.setup.peopleTitle, exact: true})).toBeVisible();
      }
      await markClosingGift(buyer, f.ids.Ana);
      const saved = await database.db.select().from(claims).where(eq(claims.familyId, f.familyId));
      await stale.click();
      await expect(coOrganizer.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      const remaining = await database.db.select().from(claims).where(eq(claims.familyId, f.familyId));
      expect(remaining).toEqual(saved);
      await buyer.reload();
      await expect(buyer.getByRole("heading", {name: "Gift for next time", exact: true})).toBeVisible();
      await expect(buyer.getByRole("checkbox", {name: "Bought", exact: true})).toBeChecked();
      await expect(buyer.getByRole("checkbox", {name: "Wrapped", exact: true})).toBeChecked();
      const phase = nextSeason ? "next-season" : "between-seasons";
      await shot(buyer, `stale-close-${phase}-retained`, {axe: false});
      closingEvidence(`stale-close-${phase}-persisted-state`, {beforeStaleClose: saved, afterStaleClose: remaining});
    } finally {
      await database.close();
      await f.close();
    }
  });
}

for (const status of ["setup", "open"] as const) {
  test(`closing waits for an in-flight ${status} claim and clears its committed mark`, async ({browser}) => {
    test.setTimeout(60_000);
    const f = await family(browser);
    const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
    const release = Promise.withResolvers<void>();
    let holding: Promise<unknown> | undefined;
    try {
      await database.db.update(exchanges).set({status}).where(eq(exchanges.id, f.exchangeId));
      const owner = await f.signedIn("Ana");
      await addClosingGift(owner, f.ids.Ana, "Concurrent winter gift");
      const buyer = await f.signedIn("Rosa");
      await buyer.goto(`/en/lists/${f.ids.Ana}`);
      const organizer = await f.signedIn("Christian");
      const close = await prepareClosingSheet(organizer, f.exchangeId);
      const locked = Promise.withResolvers<number>();
      holding = database.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM items WHERE family_id = ${f.familyId}::uuid FOR UPDATE`);
        const {rows: [row]} = await tx.execute<{pid: number}>(sql`SELECT pg_backend_pid() AS pid`);
        locked.resolve(row.pid);
        await release.promise;
      });
      void holding.catch(locked.reject);
      const blocker = await locked.promise;
      const claimed = buyer.waitForResponse((response) => response.request().method() === "POST");
      await buyer.getByRole("button", {name: en.lists.claim, exact: true}).click();
      const waiting = (pid: number) => database.db.execute<{pid: number; query: string}>(sql`
        SELECT pid, query FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
      `);
      await expect.poll(async () => (await waiting(blocker)).rows.length).toBe(1);
      const claimWait = (await waiting(blocker)).rows;
      await close.click();
      await expect.poll(async () => (await waiting(claimWait[0].pid)).rows.length).toBe(1);
      const closeWait = (await waiting(claimWait[0].pid)).rows;
      release.resolve();
      await holding;
      const claimResponse = await claimed;
      expect(claimResponse.ok()).toBe(true);
      await claimResponse.finished();
      await expect(buyer.getByRole("button", {name: en.lists.claim, exact: true})
        .or(buyer.getByRole("button", {name: en.lists.undoClaim, exact: true}))).toBeEnabled();
      await expect(buyer.getByRole("main").getByRole("alert")).toHaveCount(0);
      await expect(organizer.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      const remaining = await database.db.select().from(claims).where(eq(claims.familyId, f.familyId));
      expect(remaining).toEqual([]);
      await buyer.goto("/en/lists/getting");
      await expect(buyer.getByText(en.lists.emptyGetting, {exact: true})).toBeVisible();
      await shot(buyer, `concurrent-${status}-claim-cleared`, {axe: false});
      closingEvidence(`concurrent-${status}-lock-and-state`, {claimWait, closeWait, claimHttpStatus: claimResponse.status(), remaining});
    } finally {
      release.resolve();
      await holding;
      await database.close();
      await f.close();
    }
  });
}

for (const locale of ["en", "es"] as const) {
  test(`explains helping without a phone and returns safely in ${locale}`, async ({browser}) => {
    const f = await family(browser);
    try {
      const t = (locale === "en" ? en : es).helping;
      const guest = await f.guest();
      await guest.goto(`/${locale}/key/${await f.martaKey()}`);
      await guest.getByRole("button", {name: (locale === "en" ? en : es).getIn.hello.helping.replace("{name}", "Marta"), exact: true}).click();
      await guest.getByRole("button", {name: new RegExp(`^${t.noPhoneTitle.replace("{name}", "Marta")}`)}).click();
      await expect(guest.locator('[data-helping="choose"]').getByRole("status"))
        .toHaveText(t.noPhoneBody.replaceAll("{name}", "Marta"));
      await shot(guest, `helping-no-phone-${locale}`);
      await guest.locator('[data-helping="choose"]').getByRole("button", {name: locale === "en" ? "Go back" : "Volver", exact: true}).click();
      await expect(guest.getByRole("button", {name: new RegExp(`^${t.hereTitle.replace("{name}", "Marta")}`)})).toBeVisible();
    } finally {
      await f.close();
    }
  });

  test(`copies a relative's key and edited topic drafts to the real browser clipboard in ${locale}`, async ({browser, browserName}) => {
    test.skip(browserName !== "chromium", "Playwright exposes clipboard read/write permissions in Chromium.");
    const f = await family(browser);
    try {
      const t = (locale === "en" ? en : es).helping;
      const chat = (locale === "en" ? en : es).notify.groupChat;
      const guest = await f.guest({...phone, permissions: ["clipboard-read", "clipboard-write"]});
      await guest.goto(`/${locale}/key/${await f.martaKey()}`);
      const privateKeyUrl = guest.url();
      await guest.getByRole("button", {name: (locale === "en" ? en : es).getIn.hello.helping.replace("{name}", "Marta"), exact: true}).click();
      await guest.getByRole("button", {name: new RegExp(`^${t.sendTitle.replace("{name}", "Marta")}`)}).click();
      await expect(guest.getByRole("status")).toHaveText(t.copied.replace("{name}", "Marta"));
      expect(await guest.evaluate(() => navigator.clipboard.readText())).toBe(privateKeyUrl);
      await shot(guest, `helping-key-copied-${locale}`);

      const organizer = await f.signedIn("Christian", {...phone, permissions: ["clipboard-read", "clipboard-write"]});
      await organizer.goto(`/${locale}/family/group-chat`);
      const custom = locale === "en" ? "Christmas plans 🎁 — meet at Ana’s!" : "Planes de Navidad 🎁 — ¡nos vemos en casa de Ana!";
      await organizer.getByRole("button", {name: chat.edit, exact: true}).click();
      await organizer.getByRole("textbox", {name: chat.field, exact: true}).fill(custom);
      await organizer.getByRole("button", {name: chat.doneEditing, exact: true}).click();
      await organizer.getByText(chat.chip.wishlists, {exact: true}).click();
      await expect(organizer.getByRole("radio", {name: chat.chip.wishlists, exact: true})).toBeChecked();
      await expect(organizer.getByRole("region", {name: chat.topic.wishlists})).toContainText(locale === "en"
        ? "Come add your wishlist" : "¡Agrega tu lista de deseos");
      await organizer.getByText(chat.chip.draw, {exact: true}).click();
      await expect(organizer.getByRole("radio", {name: chat.chip.draw, exact: true})).toBeChecked();
      await expect(organizer.getByRole("region", {name: chat.topic.draw})).toContainText(custom);
      await organizer.getByRole("button", {name: chat.copy, exact: true}).click();
      await expect(organizer.getByRole("status")).toHaveText(chat.copied);
      expect(await organizer.evaluate(() => navigator.clipboard.readText())).toBe(custom);
      const whatsapp = new URL((await organizer.getByRole("link", {name: chat.whatsapp, exact: true}).getAttribute("href"))!);
      expect(whatsapp.origin).toBe("https://wa.me");
      expect(whatsapp.searchParams.get("text")).toBe(custom);
      await shot(organizer, `edited-message-copied-${locale}`);
      await test.info().attach("clipboard-and-share-output", {body: JSON.stringify({locale,
        privateKeyCopiedExactly: true, copiedMessage: custom, whatsappMessage: whatsapp.searchParams.get("text")}), contentType: "application/json"});
    } finally {
      await f.close();
    }
  });

  test(`follows the helping reveal buttons in ${locale}`, async ({browser}) => {
    const f = await family(browser);
    try {
      const helper = await f.signedIn("Rosa");
      await helper.goto("/en/account");
      await helper.getByRole("button", {name: "Help Tito", exact: true}).click();
      await expect(helper).toHaveURL(/\/en\/helping$/);
      await helper.goto(`/${locale}/helping`);
      await expect(helper.getByText(locale === "en"
        ? "Hand Tito your phone. Tap “Show Tito”, then Tito taps “Open your person”. You can look away."
        : "Pásale tu teléfono a Tito. Toca “Mostrar a Tito”; después, Tito toca “Descubrir a tu persona”. Tú puedes mirar hacia otro lado.")).toBeVisible();
      await helper.getByRole("link", {name: locale === "en" ? "Show Tito" : "Mostrar a Tito", exact: true}).click();
      const words = locale === "en" ? en : es;
      await helper.getByRole("button", {name: words.draw.person.revealTap, exact: true}).click();
      await expect(helper.getByRole("button", {name: words.draw.person.seePage.replace("{name}", "Beto"), exact: true})).toBeVisible();
    } finally {
      await f.close();
    }
  });
}

test("helping someone, notices, the family chat and the end of the season match the final design", async ({browser}) => {
  test.setTimeout(240_000);
  const f = await family(browser);
  try {
    // Notices (11.2) and the home-screen steps (3.2).
    const rosa = await f.signedIn("Rosa");
    await rosa.goto("/en/notifications");
    await expect(rosa.getByRole("heading", {name: "Notices", level: 1})).toBeVisible();
    await expect(rosa.locator('[data-notice="unread"]')).toHaveCount(2);
    await shot(rosa, "f11-11_2-notices");
    await rosa.getByRole("button", {name: "Put this on your home screen? Show me how"}).click();
    const sheet = rosa.getByRole("dialog");
    const ownPhone = test.info().project.name.includes("chromium") ? "On your Android phone" : "On your iPhone";
    await expect(sheet.getByRole("heading", {name: ownPhone})).toBeVisible();
    await shot(rosa, "f3-3_2-home-screen-steps");
    await sheet.getByRole("button", {name: /^I have an (iPhone|Android phone)$/}).click();
    await expect(sheet.getByRole("heading", {name: ownPhone === "On your iPhone" ? "On your Android phone" : "On your iPhone"})).toBeVisible();
    await shot(rosa, "f3-3_2-home-screen-steps-other-phone");
    await sheet.getByRole("button", {name: "Got it"}).click();
    await expect(sheet).toBeHidden();
    await rosa.getByRole("button", {name: "Mark as read"}).first().click();
    await expect(rosa.locator('[data-notice="unread"]')).toHaveCount(1);

    // Helping Tito: his person is ready (9.7), then his list in helping mode (9.6), then Done.
    await rosa.goto("/en/account");
    await rosa.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(rosa).toHaveURL(/\/en\/helping$/);
    await expect(rosa.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Tito");
    await expect(rosa.getByRole("heading", {name: "Tito's person is ready"})).toBeVisible();
    await expect(rosa.getByRole("link", {name: "Show Tito"})).toHaveAttribute("href", `/en/exchanges/${f.exchangeId}`);
    await shot(rosa, "f9-9_7-person-ready");
    await rosa.getByRole("link", {name: "Later"}).click();
    await expect(rosa).toHaveURL(new RegExp(`/en/lists/${f.ids.Tito}$`));
    await expect(rosa.getByRole("region", {name: "Helping mode"})).toBeVisible();
    await shot(rosa, "f9-9_6-helping-tito", {axe: false});

    // Spanish (13): the same screens wrap rather than shrink.
    await rosa.goto("/es/helping");
    await expect(rosa.getByRole("heading", {name: "La persona de Tito está lista"})).toBeVisible();
    await expect(rosa.getByRole("region", {name: "Modo de ayuda"})).toContainText("Estás ayudando a Tito");
    await shot(rosa, "f13-es-9_7-person-ready");
    await rosa.getByRole("button", {name: "Listo"}).click();
    await expect(rosa).toHaveURL(/\/es\/account$/);
    await expect(rosa.getByRole("region", {name: "Modo de ayuda"})).toHaveCount(0);
    await rosa.goto("/es/notifications");
    await expect(rosa.getByRole("heading", {name: "Avisos", level: 1})).toBeVisible();
    await shot(rosa, "f13-es-11_2-notices");

    // The largest text size (13.5): the screen reflows at 200% with nothing cut off.
    const large = await f.signedIn("Rosa", largest);
    await large.goto("/en/notifications");
    await shot(large, "f13-13_5-largest-notices");
    await large.goto("/en/account");
    await large.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(large.getByRole("heading", {name: "Tito's person is ready"})).toBeVisible();
    await shot(large, "f13-13_5-largest-person-ready");

    // Reduced motion: the sheet fades in quickly instead of rising.
    await rosa.emulateMedia({reducedMotion: "reduce"});
    await rosa.goto("/en/notifications");
    await rosa.getByRole("button", {name: "Put this on your home screen? Show me how"}).click();
    const durations = await rosa.evaluate(() => document.getAnimations().map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)));
    expect(Math.max(0, ...durations)).toBeLessThanOrEqual(160);
    await shot(rosa, "reduced-motion-home-screen-steps");

    // Someone else's key: "No, I'm helping Marta" (9.1), then handing her the phone (9.2).
    const key = await f.martaKey();
    for (const locale of ["en", "es"] as const) {
      const helper = await f.guest();
      await helper.goto(`/${locale}/key/${key}`);
      await helper.getByRole("button", {name: (locale === "en" ? en : es).getIn.hello.helping.replace("{name}", "Marta")}).click();
      await expect(helper.getByRole("heading", {name: locale === "en" ? "Helping Marta?" : "¿Ayudas a Marta?"})).toBeVisible();
      await shot(helper, `${locale === "en" ? "f9" : "f13-es"}-9_1-helping-marta`);
      await helper.getByRole("button", {name: locale === "en" ? /^Marta is here with me/ : /^Marta está aquí conmigo/}).click();
      await shot(helper, `${locale === "en" ? "f9" : "f13-es"}-9_2-hand-phone`);
      await helper.getByRole("button", {name: locale === "en" ? "Marta has the phone" : "Marta ya tiene el teléfono"}).click();
      await expect(helper.getByRole("heading", {name: (locale === "en" ? en : es).getIn.pin.makeTitle})).toBeVisible();
    }

    // Tell the family (7.16).
    const christian = await f.signedIn("Christian");
    await christian.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {value: {writeText: async (text: string) => sessionStorage.setItem("copied", text)}});
    });
    await christian.goto("/en/family/group-chat");
    const message = christian.getByRole("region", {name: "Names are drawn!"});
    await expect(message).toContainText("Names are drawn! Open the app to see your person.");
    await shot(christian, "f7-7_16-tell-the-family");
    await message.getByRole("button", {name: "Edit"}).click();
    await message.getByRole("textbox", {name: "Message"}).fill("Names are drawn! Open your own key from me.");
    await message.getByRole("button", {name: "Done"}).click();
    await message.getByRole("button", {name: "Copy message"}).click();
    await expect(christian.getByRole("status").filter({hasText: "Message copied."})).toBeVisible();
    expect(await christian.evaluate(() => sessionStorage.getItem("copied"))).toBe("Names are drawn! Open your own key from me.");
    await christian.goto("/es/family/group-chat");
    await expect(christian.getByRole("heading", {name: "Avísale a la familia"})).toBeVisible();
    await shot(christian, "f13-es-7_16-tell-the-family");

    // The end of the season: close it (12.2), then the wrap (12.3).
    await christian.goto(`/en/exchanges/${f.exchangeId}/manage`);
    await christian.getByRole("button", {name: "Close exchange"}).click();
    const close = christian.getByRole("dialog", {name: "Close Christmas 2026?"});
    await expect(close).toBeVisible();
    await shot(christian, "f12-12_2-close-the-season");
    await close.getByRole("button", {name: "Close Christmas 2026"}).click();
    await expect(christian).toHaveURL(new RegExp(`/en/exchanges/${f.exchangeId}$`));
    await expect(christian.getByRole("heading", {name: "That's a wrap"})).toBeVisible();
    await shot(christian, "f12-12_3-thats-a-wrap");
    await christian.goto(`/es/exchanges/${f.exchangeId}`);
    await expect(christian.getByRole("heading", {name: "Y eso es todo"})).toBeVisible();
    await shot(christian, "f13-es-12_3-thats-a-wrap");
    // Once closed there is no person to show, so helping Tito goes straight to his list.
    await rosa.goto("/en/account");
    await rosa.getByRole("button", {name: "Help Tito", exact: true}).click();
    await expect(rosa).toHaveURL(new RegExp(`/en/lists/${f.ids.Tito}$`));
  } finally {
    await f.close();
  }
});
