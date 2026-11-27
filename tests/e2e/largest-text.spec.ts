import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContextOptions, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {aboutMe, claims, exchanges, families, items, outbox, participants, people, sizes} from "../../src/server/db/schema";
import {issueKey} from "../../src/server/auth/access";
import {authEvents, pinCredentials} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {assignments, drawRuleSnapshots, practiceFamilies, questions} from "../../src/server/draw/schema";
import {drawSeal, sealText} from "../../src/server/draw/sealing";
import {requireIssuedKey} from "../helpers/issued-key";
import {largest, layoutProblems, settle} from "../helpers/largest-text";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

// Every main screen at the largest text size (the browser at 200%, so the 390px phone lays out at 195
// CSS pixels), in English and Spanish, with reduced motion: nothing scrolls sideways or runs off the
// phone, no text is cut off, no word breaks in two that a line could hold whole, and axe finds nothing.
// Each screen is saved whole to E2E_EVIDENCE_DIR (default test-results/largest-text/).
const names = ["Christian", "Rosa", "Tito", "Ana", "Beto", "Leo", "Marta", "Christopher"] as const;
type Name = (typeof names)[number];
const messages = {en, es} as const;
const longTitle = "PREMIUM NOISE CANCELLING WIRELESS HEADPHONES WITH RECHARGEABLE BATTERY AND COMFORTABLE EAR CUSHIONS FOR MUSIC MOVIES AND TRAVEL ".repeat(2).slice(0, 200);

/** A family with a drawn exchange (Christian has opened his person, Rosa has not), or one still in setup. */
async function family(browser: Browser, origin: string, status: "setup" | "drawn", organizerName = "Christian") {
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  const familyId = randomUUID();
  const exchangeId = randomUUID();
  const ids = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<Name, string>;
  const playing = [ids.Christian, ids.Rosa, ids.Ana, ids.Tito, ids.Leo, ids.Beto];
  const next = new Map(playing.map((id, index) => [id, playing[(index + 1) % playing.length]]));
  const key = Buffer.from(process.env.E2E_ASSIGNMENT_ENCRYPTION_KEY!, "base64");
  const pinHash = await hashPin(process.env.E2E_AUTH_SECRET!, "4268");
  const joinedAt = new Date(Date.now() - 7 * 86_400_000);
  const helpers: Partial<Record<string, string>> = {[ids.Tito]: ids.Rosa, [ids.Leo]: ids.Ana};
  await database.db.insert(families).values({id: familyId, name: `Martinez family ${familyId.slice(0, 4)}`});
  await database.db.insert(people).values(names.map((name) => ({familyId, id: ids[name], displayName: name === "Christian" ? organizerName : name,
    role: name === "Christian" ? "organizer" as const : "member" as const})));
  for (const [personId, helperId] of Object.entries(helpers)) {
    await runForFamily(database.db, familyId, (tx) => tx.update(people).set({helperId}).where(eq(people.id, personId)));
  }
  await database.db.insert(pinCredentials).values([ids.Christian, ids.Rosa, ids.Ana, ids.Beto]
    .map((personId) => ({familyId, personId, pinHash, joinedAt, changedAt: joinedAt})));
  // the family still setting up has a longer name, so Home's season label runs to more lines
  const name = status === "drawn" ? "Christmas 2026" : "Nochebuena-con-los-abuelos-2026";
  await database.db.insert(exchanges).values({familyId, id: exchangeId, name, giftDay: "2026-12-24",
    giftTime: "19:00", place: "Ana's house", budgetAmount: "50", listDeadline: "2026-12-10", status,
    ...status === "drawn" ? {drawVersion: 1, seal: drawSeal(key, familyId, exchangeId, 1, next)} : {}});
  await database.db.insert(participants).values(playing.map((personId) => ({familyId, exchangeId, personId, status: "in" as const,
    seenVersion: status === "drawn" && (personId === ids.Christian || personId === ids.Beto) ? 1 : null})));
  if (status === "drawn") {
    await database.db.insert(drawRuleSnapshots).values({familyId, exchangeId,
      roster: playing.map((id) => ({id, helperId: helpers[id] ?? null, householdId: null})), keepApart: []});
    await database.db.insert(assignments).values(playing.map((giverId) => ({familyId, exchangeId, giverId, version: 1,
      recipientSealed: sealText(key, {familyId, exchangeId, giverId, version: 1, field: "assignment"}, next.get(giverId)!)})));
  }
  const gifts = [
    {ownerId: ids.Rosa, title: "Cast-iron skillet, 12 inch", store: "Target", price: "34.99", starred: true, note: "The black one, please"},
    {ownerId: ids.Rosa, title: "Wool socks", store: "REI", price: "18.00"},
    {ownerId: ids.Christian, title: "Noise-cancelling headphones", store: "Best Buy", price: "79.99"},
    {ownerId: ids.Christian, title: "A good mystery novel", note: "Anything by Tana French"},
    {ownerId: ids.Rosa, title: "HEADPHONES"},
  ].map((gift, position) => ({...gift, familyId, id: randomUUID(), kind: "note" as const, position}));
  await database.db.insert(items).values(gifts);
  await database.db.insert(claims).values({familyId, itemId: gifts[1].id, claimerId: ids.Christian, exchangeId});
  await database.db.insert(sizes).values([
    {familyId, personId: ids.Rosa, kind: "shirt", value: "M"},
    {familyId, personId: ids.Christian, kind: "shirt", value: "L"},
  ]);
  await database.db.insert(aboutMe).values({familyId, personId: ids.Rosa, likes: "Gardening, mystery novels", colors: "Red and green"});
  const day = (date: string) => new Date(`${date}T18:00:00Z`);
  await database.db.insert(outbox).values([
    {template: "budget-changed", createdAt: day("2026-12-11"), readAt: null},
    {template: "names-drawn", createdAt: day("2026-11-29"), readAt: null},
    {template: "list-reminder", createdAt: day("2026-12-04"), readAt: day("2026-12-04")},
  ].flatMap((notice) => [ids.Rosa, ids.Christian].map((personId) => ({...notice, familyId, personId, channel: "push" as const,
    language: "en" as const, status: "captured" as const}))));

  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  async function open(name: Name | "guest", options: BrowserContextOptions) {
    const context = await browser.newContext(options);
    contexts.push(context);
    if (name !== "guest") {
      const token = secret();
      const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids[name], digest(token), "iphone", new Date()));
      await context.addCookies([
        {name: "__Host-fge-session", value: session.cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
        {name: "__Host-fge-family", value: familyId, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
        {name: "__Host-fge-device", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      ]);
    }
    return context.newPage();
  }
  async function keyFor(name: Name) {
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids.Christian, digest(secret()), "iphone", new Date()));
    const organizer = {familyId, personId: ids.Christian, actingAs: ids.Christian, sessionId: session.id, isOrganizer: true};
    const issued = requireIssuedKey(await runForFamily(database.db, familyId, (tx) =>
      issueKey(tx, organizer, ids[name], "share", process.env.E2E_AUTH_SECRET!, new Date())));
    return `${familyId}~${issued.token}`;
  }
  return {familyId, exchangeId, ids, gifts, open, keyFor, async answeredQuestion() {
    const id = randomUUID();
    const binding = {familyId, exchangeId, giverId: ids.Beto, questionId: id, version: 1};
    await database.db.insert(questions).values({familyId, exchangeId, id, askerId: ids.Beto, drawVersion: 1,
      recipientSealed: sealText(key, {...binding, field: "question-recipient"}, ids.Christian),
      text: sealText(key, {...binding, field: "question-text"}, "Which color?").toString("base64"),
      answer: sealText(key, {...binding, field: "question-answer"}, "Blue, please.").toString("base64"), answeredAt: new Date()});
  }, async notice() {
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids.Christian, digest(secret()), "computer", new Date()));
    const [event] = await database.db.insert(authEvents).values({familyId, personId: ids.Christian,
      kind: "newDevice", deviceKind: "computer", sessionId: session.id}).returning({id: authEvents.id});
    return `/account/notices/${event.id}`;
  }, async installHome() {
    await database.db.update(outbox).set({readAt: new Date()}).where(eq(outbox.personId, ids.Christian));
    return "/";
  }, async changedGift() {
    const gift = gifts[1];
    await database.db.update(claims).set({seen: {title: gift.title, note: null, url: null, store: gift.store!,
      price: gift.price!, imageKey: "previous-photo.jpg"}}).where(eq(claims.itemId, gift.id));
    await database.db.update(items).set({title: "headphones", updatedAt: new Date()}).where(eq(items.id, gift.id));
  }, async loadingList() {
    await database.db.insert(items).values({familyId, ownerId: ids.Ana, kind: "link", title: "Wool socks", store: "Target",
      position: 0, url: "https://www.target.com/p/wool-socks/-/A-12345",
      preview: {title: "Wool socks", pending: Date.now()}});
    return `/lists/${ids.Ana}`;
  }, async longList() {
    await database.db.insert(items).values({familyId, ownerId: ids.Beto, kind: "note", title: longTitle, position: 0});
    return `/lists/${ids.Beto}`;
  }, async close() {
    await Promise.allSettled(contexts.map((context) => context.close()));
    const practice = await database.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, familyId));
    await database.db.delete(families).where(eq(families.id, familyId));
    for (const row of practice) await database.db.delete(families).where(eq(families.id, row.practiceFamilyId));
    await database.close();
  }};
}

type Family = Awaited<ReturnType<typeof family>>;
type Messages = (typeof messages)[keyof typeof messages];
type Screen = {
  name: string; who: Name | "guest"; family?: "setup" | "drawn";
  path: (f: Family, other: Family) => string | Promise<string>;
  options?: BrowserContextOptions;
  /** What to do once the page is open, such as opening a sheet. */
  then?: (page: Page, t: Messages) => Promise<void>;
  afterLayout?: (page: Page, t: Messages) => Promise<void>;
};

async function removeForUndo(page: Page, t: Messages, title: string) {
  await page.getByRole("link", {name: t.lists.editNamedItem.replace("{title}", title), exact: true}).click();
  const dialog = page.getByRole("dialog", {name: t.lists.editItem});
  await expect(dialog).toBeVisible();
  await page.clock.pauseAt(new Date());
  await dialog.getByRole("button", {name: t.lists.deleteItem, exact: true}).click();
  await page.clock.runFor(500);
  await expect(page.getByRole("button", {name: t.ui.undo, exact: true})).toBeInViewport({ratio: 1});
  await expect(page.getByRole("article", {name: title, exact: true})).toHaveCount(0);
}

async function undoRemoval(page: Page, t: Messages, title: string) {
  await page.getByRole("button", {name: t.ui.undo, exact: true}).click();
  await page.clock.resume();
  await expect(page.getByRole("article", {name: title, exact: true})).toBeVisible();
}

async function openInstall(page: Page, t: Messages, phone: "iphone" | "android") {
  await page.getByRole("button", {name: t.homeScreen.installButton, exact: true}).click();
  const title = phone === "iphone" ? t.homeScreen.iphoneTitle : t.homeScreen.androidTitle;
  if (!await page.getByRole("dialog", {name: title, exact: true}).count()) {
    await page.getByRole("button", {name: phone === "iphone" ? t.homeScreen.haveIphone : t.homeScreen.haveAndroid, exact: true}).click();
  }
  await expect(page.getByRole("dialog", {name: title, exact: true})).toBeVisible();
}

async function checkRoster(page: Page) {
  const checkbox = page.getByRole("checkbox", {name: "Christopher", exact: true});
  const row = checkbox.locator("..");
  const name = row.getByText("Christopher", {exact: true});
  for (const width of [195, 390]) {
    await page.setViewportSize({width, height: width === 195 ? 422 : 844});
    await checkbox.scrollIntoViewIfNeeded();
    await settle(page);
    expect(await layoutProblems(page, "fieldset")).toEqual([]);
    const target = (await checkbox.boundingBox())!;
    const words = (await name.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(48);
    expect(target.height).toBeGreaterThanOrEqual(48);
    if (width === 195) {
      expect(words.width).toBeCloseTo((await row.boundingBox())!.width, 0);
      expect(words.y).toBeGreaterThanOrEqual(target.y + target.height);
    } else {
      expect(words.y).toBeLessThan(target.y + target.height);
      expect(words.y + words.height).toBeGreaterThan(target.y);
    }
    const checked = await checkbox.isChecked();
    await checkbox.click({position: {x: 1, y: 1}});
    await expect(checkbox).toBeChecked({checked: !checked});
    await checkbox.press("Space");
    await expect(checkbox).toBeChecked({checked});
    await row.screenshot({path: test.info().outputPath(`roster-${width}.png`)});
  }
  await page.setViewportSize(largest.viewport);
}

const screens: Screen[] = [
  {name: "home", who: "Christian", path: () => "/"},
  {name: "home-member", who: "Rosa", path: () => "/"},
  {name: "home-install", who: "Christian", path: (f) => f.installHome(), then: async (page, t) => {
    await expect(page.getByRole("heading", {name: t.homeScreen.installTitle, exact: true})).toBeVisible();
  }},
  {name: "home-install-iphone", who: "Christian", path: (f) => f.installHome(), then: async (page, t) => {
    await openInstall(page, t, "iphone");
  }},
  {name: "home-install-android", who: "Christian", path: (f) => f.installHome(), then: async (page, t) => {
    await openInstall(page, t, "android");
  }},
  {name: "home-install-in-app", who: "Christian", path: (f) => f.installHome(), options: {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.26.0",
  }, then: async (page, t) => {
    await openInstall(page, t, "iphone");
    await expect(page.getByText(t.homeScreen.inAppWarning, {exact: true})).toBeVisible();
  }},
  {name: "my-list", who: "Christian", path: (f) => `/lists/${f.ids.Christian}`},
  {name: "empty-wishlist", who: "Beto", path: (f) => `/lists/${f.ids.Beto}`, then: async (page, t) => {
    await expect(page.getByRole("heading", {name: t.lists.emptyTitle, exact: true})).toBeVisible();
  }},
  {name: "loading-save", who: "Ana", path: (f) => f.loadingList(), then: async (page, t) => {
    await expect(page.getByRole("status").filter({hasText: t.lists.pictureComing.replace("{store}", "Target")})).toBeVisible();
  }},
  {name: "undo-toast", who: "Christian", path: (f) => `/lists/${f.ids.Christian}`, then: async (page, t) => {
    await removeForUndo(page, t, "Noise-cancelling headphones");
  }, afterLayout: async (page, t) => {
    await undoRemoval(page, t, "Noise-cancelling headphones");
  }},
  {name: "long-undo-toast", who: "Beto", path: (f) => f.longList(), then: async (page, t) => {
    await removeForUndo(page, t, longTitle);
    const message = page.locator("[data-toast-host] p");
    await expect(message).toHaveText(t.lists.tookOff.replace("{title}", longTitle));
    const bounds = await message.evaluate((element) => ({top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom, viewport: window.innerHeight,
      height: element.clientHeight, content: element.scrollHeight}));
    expect(bounds.top).toBeGreaterThanOrEqual(12);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.content).toBeGreaterThan(bounds.height);
    await message.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await message.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", {name: t.ui.undo, exact: true})).toBeInViewport({ratio: 1});
  }, afterLayout: async (page, t) => {
    await undoRemoval(page, t, longTitle);
  }},
  {name: "add-something", who: "Christian", path: (f) => `/lists/${f.ids.Christian}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.lists.addSomething, exact: true}).click();
    await expect(page.getByRole("dialog", {name: t.lists.addSomething})).toBeVisible();
  }},
  {name: "my-profile", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/profile`},
  {name: "profile-size-chips", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/profile`, then: async (page, t) => {
    await page.evaluate(() => document.fonts.ready);
    for (const name of [t.lists.size.tops, t.lists.size.bottoms]) {
      const group = page.getByRole("group", {name, exact: true});
      await group.getByText("2XL", {exact: true}).click();
      await expect(group.getByRole("radio", {name: "2XL", exact: true})).toBeChecked();
      const labels = await group.locator("label").evaluateAll((elements) => elements.map((element) => {
        const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const glyphs = range.getBoundingClientRect(), box = element.getBoundingClientRect();
        return {left: glyphs.left - box.left, right: box.right - glyphs.right};
      }));
      expect(labels).toHaveLength(6);
      for (const label of labels) {
        expect(label.left).toBeGreaterThanOrEqual(-0.5);
        expect(label.right).toBeGreaterThanOrEqual(-0.5);
      }
    }
  }},
  {name: "profile-waist-and-length", who: "Beto", path: (f) => `/lists/${f.ids.Beto}/profile`, then: async (page, t) => {
    await page.getByRole("button", {name: t.lists.waistAndLength, exact: true}).click();
    await page.getByLabel(t.lists.size.waist, {exact: true}).fill("32");
    await page.getByLabel(t.lists.size.length, {exact: true}).fill("30");
    const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/profile"));
    await page.getByLabel(t.lists.size.length, {exact: true}).blur();
    await saved;
    await expect(page.getByRole("status").filter({hasText: t.lists.saved})).toBeVisible();
  }},
  {name: "profile-other-sizes", who: "Beto", path: (f) => `/lists/${f.ids.Beto}/profile`, then: async (page, t) => {
    await page.getByRole("button", {name: t.lists.otherSize, exact: true}).first().click();
    await page.getByLabel(t.lists.size.tops, {exact: true}).fill("Kids 12");
    await page.getByRole("button", {name: t.lists.otherSize, exact: true}).click();
    await page.getByLabel(t.lists.size.bottoms, {exact: true}).fill("Kids 10");
    await page.getByText(t.lists.moreSizes, {exact: true}).click();
    await expect(page.getByLabel(t.lists.size.hat, {exact: true})).toBeVisible();
  }},
  {name: "profile-no-clothes", who: "Beto", path: (f) => `/lists/${f.ids.Beto}/profile`, then: async (page, t) => {
    await page.getByRole("switch", {name: t.lists.noClothes, exact: true}).click();
    await expect(page.getByRole("switch", {name: t.lists.noClothes, exact: true})).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("status").filter({hasText: t.lists.saved})).toBeVisible();
  }},
  {name: "profile-shoe-stepper", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/profile`, then: async (page, t) => {
    await page.getByRole("combobox", {name: t.lists.size.shoeSystem, exact: true}).selectOption("us-women");
    await page.getByRole("button", {name: t.lists.shoeBigger, exact: true}).click();
    await expect(page.getByRole("combobox", {name: t.lists.size.shoes, exact: true})).toHaveValue("7");
    await page.getByRole("button", {name: t.lists.shoeSmaller, exact: true}).click();
    await expect(page.getByRole("combobox", {name: t.lists.size.shoes, exact: true})).toHaveValue("6½");
  }},
  {name: "new-note", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/items/new?kind=note`},
  {name: "new-link", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/items/new?kind=link`},
  {name: "edit-item", who: "Christian", path: (f) => `/lists/${f.ids.Christian}/items/${f.gifts[2].id}/edit`},
  {name: "lists", who: "Christian", path: () => "/lists"},
  {name: "someones-list", who: "Christian", path: (f) => `/lists/${f.ids.Rosa}`},
  {name: "christians-list", who: "Rosa", path: (f) => `/lists/${f.ids.Christian}`},
  {name: "getting", who: "Christian", path: () => "/lists/getting"},
  {name: "family", who: "Christian", path: () => "/family"},
  {name: "family-keys", who: "Christian", path: () => "/family/keys"},
  {name: "family-key-print", who: "Christian", path: () => "/family/keys", then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.keys.printCards, exact: true}).click();
    const dialog = page.getByRole("dialog", {name: t.auth.sendKeys, exact: true});
    await expect(dialog.getByRole("img", {name: t.auth.keyQr, exact: true}).first()).toBeVisible();
    await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(0);
  }},
  {name: "group-chat", who: "Christian", path: () => "/family/group-chat"},
  {name: "account", who: "Christian", path: () => "/account"},
  {name: "account-helper", who: "Rosa", path: () => "/account"},
  {name: "activity", who: "Christian", path: () => "/account/activity"},
  {name: "notices", who: "Christian", path: () => "/account/notices"},
  {name: "notice-details", who: "Christian", path: (f) => f.notice(), then: async (page, t) => {
    await expect(page.getByRole("heading", {name: t.getIn.wasThat.title, exact: true})).toBeVisible();
  }},
  {name: "phones", who: "Christian", path: () => "/account/phones"},
  {name: "pin", who: "Christian", path: () => "/account/pin"},
  {name: "notifications", who: "Rosa", path: () => "/notifications"},
  {name: "face-id", who: "Christian", path: () => "/face-id"},
  {name: "helping", who: "Rosa", path: () => "/account", then: async (page, t) => {
    await page.getByRole("button", {name: t.auth.helpAs.replace("{name}", "Tito"), exact: true}).click();
    await page.waitForURL(/\/helping$/);
  }},
  {name: "your-person", who: "Christian", path: (f) => `/exchanges/${f.exchangeId}`},
  {name: "your-person-christian-list", who: "Beto", path: (f) => `/exchanges/${f.exchangeId}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.reveal, exact: true}).click();
    await expect(page.getByRole("heading", {name: t.draw.person.listTitle.replace("{name}", "Christian"), exact: true})).toBeVisible();
  }},
  {name: "your-person-question-waiting", who: "Beto", path: (f) => `/exchanges/${f.exchangeId}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.reveal, exact: true}).click();
    await page.getByRole("button", {name: t.draw.person.ask.replace("{name}", "Christian"), exact: true}).click();
    await page.getByLabel(t.draw.askLabel, {exact: true}).fill("What color would you like?");
    await page.getByRole("button", {name: t.draw.askButton, exact: true}).click();
    await expect(page.locator('[data-question="waiting"]')).toContainText(t.draw.person.sentTo.replace("{name}", "Christian"));
  }},
  {name: "your-person-reveal", who: "Rosa", path: (f) => `/exchanges/${f.exchangeId}`},
  {name: "your-person-opened", who: "Rosa", path: (f) => `/exchanges/${f.exchangeId}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.person.revealTap, exact: true}).click();
    await expect(page.getByRole("button", {name: t.draw.person.revealTap, exact: true})).toHaveCount(0);
  }},
  {name: "something-wrong", who: "Christian", path: (f) => `/exchanges/${f.exchangeId}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.report, exact: true}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }},
  {name: "exchanges", who: "Christian", path: () => "/exchanges"},
  {name: "manage", who: "Christian", path: (f) => `/exchanges/${f.exchangeId}/manage`},
  {name: "manage-redraw-roster", who: "Christian", path: (f) => `/exchanges/${f.exchangeId}/manage`, then: async (page, t) => {
    const summary = page.locator("summary");
    await summary.getByText(t.draw.forceRedraw, {exact: true}).or(summary.getByText(t.draw.redraw, {exact: true})).click();
    await expect(page.getByRole("checkbox", {name: "Christopher", exact: true})).toBeVisible();
    await page.getByRole("checkbox", {name: "Christopher", exact: true}).scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({path: test.info().outputPath("expanded-roster-viewport.png")});
  }, afterLayout: checkRoster},
  {name: "preview", who: "Christian", path: (f) => `/exchanges/${f.exchangeId}/preview/${f.ids.Rosa}`},
  {name: "practice", who: "Christian", path: () => "/exchanges/practice"},
  {name: "practice-started", who: "Christian", path: () => "/exchanges/practice", then: async (page, t) => {
    await page.getByRole("button", {name: t.draw.practiceStart, exact: true}).click();
    await expect(page.getByRole("heading", {name: t.draw.practiceViewAs, exact: true})).toBeVisible();
  }},
  {name: "welcome-sizes", who: "Christian", path: () => "/welcome/sizes"},
  {name: "welcome-no-clothes", who: "Beto", path: () => "/welcome/sizes", then: async (page, t) => {
    const toggle = page.getByRole("switch", {name: t.getIn.sizes.noClothes, exact: true});
    if (await toggle.getAttribute("aria-checked") === "false") await toggle.click();
    await expect(page.getByRole("status").filter({hasText: t.getIn.sizes.noClothesDone})).toBeVisible();
  }},
  {name: "welcome-shoe-systems", who: "Ana", path: () => "/welcome/sizes", then: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.sizes.systemNone, exact: true}).click();
    await expect(page.getByRole("dialog", {name: t.getIn.sizes.systemTitle, exact: true})).toBeVisible();
  }},
  {name: "welcome-other-shoes", who: "Ana", path: () => "/welcome/sizes", then: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.sizes.systemNone, exact: true}).click();
    await page.getByRole("dialog").getByText(t.getIn.sizes.system.other, {exact: true}).click();
    await settle(page);
    const field = page.getByRole("textbox", {name: t.getIn.sizes.shoes, exact: true});
    await field.fill("EU 43");
    await expect(field).toHaveValue("EU 43");
  }},
  {name: "welcome-list", who: "Christian", path: () => "/welcome/list"},
  {name: "welcome-photo", who: "Christian", path: () => "/welcome/list", then: async (page, t) => {
    await page.locator('input[type="file"]').setInputFiles("public/gift-192.png");
    await expect(page.getByRole("img", {name: t.getIn.add.photoAlt, exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: t.getIn.add.photoChange, exact: true})).toBeEnabled();
    await page.getByLabel(t.getIn.add.photoTitle, {exact: true}).fill("Wool scarf");
  }},
  {name: "welcome-link-empty", who: "Christian", path: () => "/welcome/list", then: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.add.paste, exact: true}).click();
    await expect(page.getByLabel(t.getIn.paste.field, {exact: true})).toHaveValue("");
  }},
  {name: "welcome-link-failed", who: "Christian", path: () => "/welcome/list", options: {serviceWorkers: "block"}, then: async (page, t) => {
    await page.route("**/lists/*/link-preview", (route) => route.fulfill({json: {}}));
    await page.getByRole("button", {name: t.getIn.add.paste, exact: true}).click();
    await page.getByLabel(t.getIn.paste.field, {exact: true}).fill("https://www.target.com/p/wool-socks/-/A-12345");
    await expect(page.getByRole("alert").filter({hasText: t.getIn.paste.failed})).toBeVisible();
  }},
  {name: "welcome-link-loading", who: "Christian", path: () => "/welcome/list", then: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.add.paste, exact: true}).click();
    await page.clock.pauseAt(new Date());
    await page.getByLabel(t.getIn.paste.field, {exact: true}).fill("https://www.target.com/p/wool-socks/-/A-12345");
    await page.clock.runFor(100);
    await expect(page.getByRole("status").filter({hasText: t.getIn.paste.loading.replace("{store}", "Target")})).toBeVisible();
  }, afterLayout: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.paste.clear, exact: true}).click();
    await page.clock.resume();
  }},
  {name: "welcome-link-preview", who: "Christian", path: () => "/welcome/list", options: {serviceWorkers: "block"}, then: async (page, t) => {
    await page.route("**/lists/*/link-preview", (route) => route.fulfill({json: {card: {
      url: "https://www.target.com/p/wool-socks/-/A-12345", title: "Wool socks", price: "18.00", store: "Target", icon: "target",
    }}}));
    await page.getByRole("button", {name: t.getIn.add.paste, exact: true}).click();
    await page.getByLabel(t.getIn.paste.field, {exact: true}).fill("https://www.target.com/p/wool-socks/-/A-12345");
    await expect(page.getByRole("heading", {name: "Wool socks", exact: true})).toBeVisible();
    const want = page.getByRole("button", {name: t.getIn.paste.want, exact: true});
    await expect(want).toHaveAttribute("aria-pressed", "false");
    expect(await layoutProblems(page)).toEqual([]);
    await want.click();
    await expect(want).toHaveAttribute("aria-pressed", "true");
    await expect(want).toHaveText(t.getIn.paste.want);
  }},
  {name: "welcome-done", who: "Christian", path: () => "/welcome/done"},
  {name: "setup-home-hyphenated-season", who: "Christian", family: "setup", path: () => "/"},
  {name: "setup-new", who: "Christian", family: "setup", path: () => "/exchanges/new"},
  {name: "setup-manage", who: "Christian", family: "setup", path: (f) => `/exchanges/${f.exchangeId}/manage`},
  {name: "setup-details", who: "Christian", family: "setup", path: (f) => `/exchanges/${f.exchangeId}/manage/details`},
  {name: "setup-people", who: "Christian", family: "setup", path: (f) => `/exchanges/${f.exchangeId}/manage/people`, then: async (page) => {
    await page.getByRole("checkbox", {name: "Christopher", exact: true}).scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({path: test.info().outputPath("setup-roster-viewport.png")});
  }, afterLayout: checkRoster},
  {name: "setup-family", who: "Christian", family: "setup", path: () => "/family"},
  {name: "setup-draw", who: "Christian", family: "setup", path: (f) => `/exchanges/${f.exchangeId}/manage/draw`},
  {name: "sign-in", who: "guest", path: () => "/sign-in"},
  {name: "replacement-key-asked", who: "guest", path: (f) => `/sign-in?family=${f.familyId}&person=${f.ids.Rosa}`, then: async (page, t) => {
    await page.getByRole("button", {name: t.getIn.enter.forgot, exact: true}).click();
    await page.getByRole("button", {name: t.getIn.forgot.ask.replace("{organizer}", "Christian"), exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: t.getIn.forgot.asked.replace("{organizer}", "Christian")})).toBeVisible();
  }},
  {name: "signed-in-key", who: "Christian", path: async (_f, other) => `/key/${await other.keyFor("Marta")}`},
  {name: "start", who: "guest", path: () => "/start"},
  {name: "key", who: "guest", path: async (f) => `/key/${await f.keyFor("Marta")}`},
];

for (const locale of ["en", "es"] as const) {
  test.describe(`at the largest text size in ${locale}`, () => {
    let drawn: Family;
    let setup: Family;
    test.beforeAll(async ({browser, baseURL}) => {
      const origin = new URL(baseURL!).origin;
      [drawn, setup] = await Promise.all([family(browser, origin, "drawn"), family(browser, origin, "setup")]);
    });
    test.afterAll(async () => {
      await Promise.allSettled([drawn?.close(), setup?.close()]);
    });

    for (const screen of screens) {
      test(`${screen.name} fits the phone`, async () => {
        const f = screen.family === "setup" ? setup : drawn;
        const page = await f.open(screen.who, {...largest, reducedMotion: "reduce", locale: locale === "en" ? "en-US" : "es-US", ...screen.options});
        try {
          const response = await page.goto(`/${locale}${await screen.path(f, screen.family === "setup" ? drawn : setup)}`);
          expect(response?.ok(), "the screen opens").toBe(true);
          await screen.then?.(page, messages[locale]);
          await settle(page);
          const folder = join(process.env.E2E_EVIDENCE_DIR ?? join(process.cwd(), "test-results", "largest-text"), test.info().project.name);
          mkdirSync(folder, {recursive: true});
          await page.screenshot({path: join(folder, `${locale}-${screen.name}.png`), fullPage: true});
          expect(await layoutProblems(page), "nothing runs off the phone, is cut off, or breaks inside a word").toEqual([]);
          await screen.afterLayout?.(page, messages[locale]);
          expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
        } finally {
          await page.context().close();
        }
      });
    }

    test("account report control stays readable after another-device reveal", async () => {
      const t = messages[locale];
      const first = await drawn.open("Christian", {...largest, reducedMotion: "reduce"});
      const second = await drawn.open("Christian", {...largest, reducedMotion: "reduce"});
      try {
        await first.goto(`/${locale}/exchanges/${drawn.exchangeId}`);
        await first.getByRole("button", {name: t.draw.reveal, exact: true}).click();
        await expect(first.getByRole("heading", {name: t.draw.person.listTitle.replace("{name}", "Rosa"), exact: true})).toBeVisible();
        await second.goto(`/${locale}/account`);
        const section = second.locator("section").filter({has: second.getByRole("heading", {name: t.auth.revealActivity, exact: true})});
        const report = section.getByRole("button", {name: t.auth.notMe, exact: true}).first();
        await expect(report).toBeVisible();
        for (const width of [195, 390]) {
          await second.setViewportSize({width, height: width === 195 ? 422 : 844});
          await report.scrollIntoViewIfNeeded();
          await settle(second);
          await expect(report).toHaveCSS("font-size", "20px");
          await expect(report).toHaveCSS("min-height", "60px");
          expect(await layoutProblems(second, "section")).toEqual([]);
          await second.screenshot({path: test.info().outputPath(`${locale}-account-report-${width}-viewport.png`)});
          await section.screenshot({path: test.info().outputPath(`${locale}-account-report-${width}-card.png`)});
          expect((await new AxeBuilder({page: second}).include("section").analyze()).violations).toEqual([]);
        }
      } finally {
        await first.context().close();
        await second.context().close();
      }
    });

    for (const width of [195, 390]) {
      test(`notification installation steps fit at ${width}px`, async () => {
        const page = await drawn.open("Christian", {...largest, viewport: {width, height: width === 195 ? 422 : 844},
          reducedMotion: "reduce", locale: locale === "en" ? "en-US" : "es-US"});
        try {
          const t = messages[locale].notify.install;
          await page.goto(`/${locale}/notifications`);
          await page.getByRole("button", {name: t.prompt, exact: true}).click();
          for (const phone of ["iphone", "android"] as const) {
            const title = phone === "iphone" ? t.iphoneTitle : t.androidTitle;
            if (!await page.getByRole("dialog", {name: title, exact: true}).count()) {
              await page.getByRole("button", {name: phone === "iphone" ? t.haveIphone : t.haveAndroid, exact: true}).click();
            }
            await expect(page.getByRole("dialog", {name: title, exact: true})).toBeVisible();
            await settle(page);
            const steps = await page.getByRole("list", {name: t.steps, exact: true}).locator("li").evaluateAll((elements) =>
              elements.map((element) => {
                const row = element.getBoundingClientRect(), words = element.querySelector("p")!.getBoundingClientRect();
                const number = element.firstElementChild!.getBoundingClientRect(), picture = element.lastElementChild!.getBoundingClientRect();
                return {width: row.width, wordsWidth: words.width, wordsLeft: words.left, wordsTop: words.top,
                  rowLeft: row.left, numberRight: number.right, numberBottom: number.bottom,
                  pictureLeft: picture.left, pictureBottom: picture.bottom, wordsRight: words.right};
              }));
            expect(steps).toHaveLength(3);
            for (const step of steps) {
              if (width === 195) {
                expect(step.wordsWidth).toBeCloseTo(step.width, 0);
                expect(step.wordsLeft).toBeCloseTo(step.rowLeft, 0);
                expect(step.wordsTop).toBeGreaterThanOrEqual(Math.max(step.numberBottom, step.pictureBottom));
              } else {
                expect(step.wordsLeft).toBeGreaterThan(step.numberRight);
                expect(step.wordsRight).toBeLessThan(step.pictureLeft);
              }
            }
            expect(await layoutProblems(page)).toEqual([]);
            expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
            await page.getByRole("list", {name: t.steps, exact: true}).locator("li").first()
              .screenshot({path: test.info().outputPath(`${phone}-${width}px.png`)});
          }
        } finally {
          await page.context().close();
        }
      });

      test(`changed gift values fit at ${width}px`, async ({browser, baseURL}) => {
        const f = await family(browser, new URL(baseURL!).origin, "drawn");
        const page = await f.open("Christian", {...largest, viewport: {width, height: width === 195 ? 422 : 844},
          reducedMotion: "reduce", locale: locale === "en" ? "en-US" : "es-US"});
        try {
          const t = messages[locale].lists.changed;
          await f.changedGift();
          await page.goto(`/${locale}/lists/getting`);
          await expect(page.locator('[data-changed="title"] ins')).toHaveText(`${t.now} headphones`);
          await expect(page.locator('[data-changed="photo"]')).toHaveText(t.pictureRemoved);
          await settle(page);
          for (const row of [page.locator('[data-changed="title"] ins'), page.locator('[data-changed="photo"]')]) {
            const bounds = await row.evaluate((element) => {
              const row = element.getBoundingClientRect(), arrow = element.querySelector("svg")!.getBoundingClientRect();
              const words = element.querySelector(":scope > span")!.getBoundingClientRect();
              return {rowWidth: row.width, wordsWidth: words.width, wordsTop: words.top,
                wordsLeft: words.left, arrowRight: arrow.right, arrowBottom: arrow.bottom};
            });
            if (width === 195) {
              expect(bounds.wordsWidth).toBeCloseTo(bounds.rowWidth, 0);
              expect(bounds.wordsTop).toBeGreaterThanOrEqual(bounds.arrowBottom);
            } else {
              expect(bounds.wordsLeft).toBeGreaterThan(bounds.arrowRight);
            }
          }
          expect(await layoutProblems(page)).toEqual([]);
          expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
          await page.screenshot({path: test.info().outputPath(`changed-gift-${width}px.png`), fullPage: true});
          await page.getByRole("button", {name: t.keep, exact: true}).click();
          await expect(page.locator("[data-changed]")).toHaveCount(0);
          await expect(page.getByRole("article", {name: "headphones", exact: true})
            .getByRole("checkbox", {name: messages[locale].lists.bought, exact: true})).toBeVisible();
        } finally {
          await f.close();
        }
      });

      test(`revealed pass fits Home and Family at ${width}px`, async () => {
        const page = await drawn.open("Christian", {...largest, viewport: {width, height: width === 195 ? 422 : 844},
          reducedMotion: "reduce", locale: locale === "en" ? "en-US" : "es-US"});
        try {
          const t = messages[locale];
          await page.goto(`/${locale}/exchanges/${drawn.exchangeId}`);
          await page.getByRole("button", {name: t.draw.reveal, exact: true}).click();
          await expect(page.getByRole("heading", {name: t.draw.person.listTitle.replace("{name}", "Rosa"), exact: true})).toBeVisible();
          for (const path of ["/", "/lists"]) {
            await page.goto(`/${locale}${path}`);
            const pass = page.locator("[data-pass]");
            await expect(pass).toContainText("Rosa");
            await expect(pass.getByText(t.lists.onlyYou, {exact: true})).toBeVisible();
            await settle(page);
            expect(await layoutProblems(page)).toEqual([]);
            const name = pass.locator("[data-stitched] > svg");
            const graphic = (await name.boundingBox())!;
            const naturalWidth = await name.evaluate((element) => Number(element.getAttribute("width")));
            const card = (await pass.locator('[data-tone="mine"]').boundingBox())!;
            const arrow = (await pass.locator('[data-icon="chevron"]').locator("..").boundingBox())!;
            expect(graphic.x).toBeGreaterThanOrEqual(card.x);
            expect(graphic.x + graphic.width).toBeLessThanOrEqual(card.x + card.width);
            if (width === 195) {
              expect(graphic.width).toBeLessThan(naturalWidth);
              expect(arrow.y).toBeGreaterThanOrEqual(graphic.y + graphic.height);
            } else {
              expect(graphic.width).toBeCloseTo(naturalWidth, 0);
              expect(arrow.x).toBeGreaterThanOrEqual(graphic.x + graphic.width);
            }
            await pass.screenshot({path: test.info().outputPath(`${locale}-pass-${path === "/" ? "home" : "family"}-${width}.png`)});
            expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
            await pass.click();
            await expect(page).toHaveURL((url) => url.pathname === `/${locale}/lists/${drawn.ids.Rosa}`);
          }
        } finally {
          await page.context().close();
        }
      });
    }

    for (const width of [195, 270, 280, 298, 299, 390]) {
      test(`claimed item keeps its title clear at ${width}px`, async () => {
        const page = await drawn.open("Christian", {...largest, viewport: {width, height: 844}, reducedMotion: "reduce",
          locale: locale === "en" ? "en-US" : "es-US"});
        try {
          const t = messages[locale];
          await page.goto(`/${locale}/lists/${drawn.ids.Rosa}`);
          const item = page.getByRole("article", {name: "HEADPHONES", exact: true});
          await item.getByRole("button", {name: t.lists.claim, exact: true}).click();
          await expect(item).toHaveAttribute("data-claim", "mine");
          await expect(item).toHaveAttribute("aria-busy", "false");
          await settle(page);
          const card = item.locator('[data-tone="mine"]');
          const title = card.getByRole("heading", {name: "HEADPHONES", exact: true});
          const picture = await card.locator("[data-thumb]").boundingBox();
          const heading = await title.boundingBox();
          if (width < 299) {
            expect(heading!.y).toBeGreaterThanOrEqual(picture!.y + picture!.height);
            const fullWidth = await title.evaluate((element) => {
              const card = element.closest("[data-item]")!, style = getComputedStyle(card);
              const room = card.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
              return Math.abs(element.parentElement!.getBoundingClientRect().width - room) < 1;
            });
            expect(fullWidth).toBe(true);
          } else {
            expect(heading!.y).toBeLessThan(picture!.y + picture!.height);
          }
          const covered = await title.evaluate((element) => {
            const tag = element.closest("article")!.querySelector("[data-claim-tag]")!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()].some((text) => text.left < tag.right && text.right > tag.left
              && text.top < tag.bottom && text.bottom > tag.top);
          });
          expect(covered).toBe(false);
          await page.screenshot({path: test.info().outputPath(`${locale}-claimed-${width}.png`), fullPage: true});
          await item.getByRole("button", {name: t.lists.undoClaim, exact: true}).click();
          await expect(item).toHaveAttribute("data-claim", "open");
          await expect(item).toHaveAttribute("aria-busy", "false");
        } finally {
          await page.context().close();
        }
      });
    }

    test("answered question keeps the recipient name whole", async ({browser, baseURL}) => {
      const f = await family(browser, new URL(baseURL!).origin, "drawn", "Christopher");
      try {
        await f.answeredQuestion();
        const page = await f.open("Beto", {...largest, reducedMotion: "reduce", locale: locale === "en" ? "en-US" : "es-US"});
        await page.goto(`/${locale}/exchanges/${f.exchangeId}`);
        const t = messages[locale];
        await page.getByRole("button", {name: t.draw.reveal, exact: true}).click();
        const answer = page.locator('[data-question="answered"]');
        await expect(answer).toContainText(t.draw.person.answeredBy.replace("{name}", "Christopher"));
        await expect(answer).toContainText("Blue, please.");
        await settle(page);
        expect(await layoutProblems(page)).toEqual([]);
        await page.screenshot({path: test.info().outputPath(`${locale}-answered-question.png`), fullPage: true});
        expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      } finally {
        await f.close();
      }
    });

    test("pending and ready QR fit the phone", async () => {
      const page = await drawn.open("Christian", {...largest, reducedMotion: "reduce", serviceWorkers: "block", locale: locale === "en" ? "en-US" : "es-US"});
      let release = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      try {
        const t = messages[locale];
        await page.goto(`/${locale}/family/keys`);
        await settle(page);
        await page.route("**/family/keys", async (route) => {
          if (route.request().method() === "POST") await gate;
          await route.continue();
        });
        await page.getByRole("button", {name: t.auth.showQr, exact: true}).click();
        const dialog = page.getByRole("dialog", {name: t.auth.sendKeys, exact: true});
        const placeholder = dialog.locator('[aria-busy="true"]');
        await expect(placeholder).toBeVisible();
        const square = await placeholder.boundingBox();
        expect(square!.width).toBeLessThanOrEqual(147);
        expect(Math.abs(square!.width - square!.height)).toBeLessThanOrEqual(1);
        expect(await layoutProblems(page)).toEqual([]);
        await page.screenshot({path: test.info().outputPath(`${locale}-qr-pending.png`), fullPage: true, animations: "disabled"});
        release();
        await expect(dialog.getByRole("img", {name: t.auth.keyQr, exact: true})).toBeVisible();
        await expect(placeholder).toHaveCount(0);
        await settle(page);
        expect(await layoutProblems(page)).toEqual([]);
        await page.screenshot({path: test.info().outputPath(`${locale}-qr-ready.png`), fullPage: true});
        expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      } finally {
        release();
        await page.context().close();
      }
    });

    for (const width of [195, 390]) {
      test(`organizer can add a name at ${width}px`, async () => {
        const page = await setup.open("Christian", {...largest, viewport: {width, height: width === 195 ? 422 : 844},
          deviceScaleFactor: width === 195 ? 2 : 1, reducedMotion: "reduce"});
        try {
          const t = messages[locale];
          await page.goto(`/${locale}/exchanges/${setup.exchangeId}/manage/people`);
          const input = page.getByRole("textbox", {name: t.draw.setup.addName, exact: true});
          const add = page.getByRole("button", {name: t.draw.setup.add, exact: true});
          const name = width === 195 ? "Marisol" : "Guadalupe";
          await input.fill(name);
          await settle(page);
          expect(await layoutProblems(page, "form:has(#add-names)")).toEqual([]);
          const field = (await input.boundingBox())!;
          const button = (await add.boundingBox())!;
          expect(field.width).toBeGreaterThanOrEqual(96);
          if (width === 195) expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
          else expect(button.y).toBeLessThan(field.y + field.height);
          await input.locator("..").screenshot({path: test.info().outputPath(`${locale}-organizer-input-${width}.png`)});
          await add.click();
          await expect(page.getByRole("checkbox", {name, exact: true})).toBeVisible();
          await expect(input).toHaveValue("");
          await page.reload();
          await expect(page.getByRole("checkbox", {name, exact: true})).toBeVisible();
        } finally {
          await page.context().close();
        }
      });
    }
  });
}
