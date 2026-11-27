import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContextOptions, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {exchanges, families, participants, people} from "../../src/server/db/schema";
import {issueKey} from "../../src/server/auth/access";
import {pinCredentials, sessions} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {disputeSession} from "../../src/server/auth/security";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {assignments, drawOpenings, drawRuleSnapshots} from "../../src/server/draw/schema";
import {drawSeal, sealText} from "../../src/server/draw/sealing";
import {requireIssuedKey} from "../helpers/issued-key";
import {signInWithPin, typePin} from "../helpers/pin-pad";
import {openPerson} from "../helpers/open-person";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

// Helping on a borrowed phone (9.1 to 9.5): Rosa has no phone, so she opens her own first key on Ana's
// phone while it stays signed in as Ana. Screens are saved at 390 by 844 (E2E_EVIDENCE_DIR overrides
// test-results/design/), in English and Spanish, with reduced motion and at the largest text size.
const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true} satisfies BrowserContextOptions;
// The largest text size: the browser at 200%, so the 390px phone lays out at 195 CSS pixels.
const largest = {...phone, viewport: {width: 195, height: 422}, deviceScaleFactor: 6} satisfies BrowserContextOptions;
const names = ["Christian", "Ana", "Rosa", "Beto", "Leo"] as const;
type Name = (typeof names)[number];
type Language = "en" | "es";
const words = (language: Language) => (language === "en" ? en : es);
const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), text);

async function family(browser: Browser, {drawn = true, recoveryBacklog = false} = {}) {
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  const familyId = randomUUID();
  const exchangeId = randomUUID();
  const ids = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<Name, string>;
  // Rosa gives to Beto, as in the frames.
  const relatives = recoveryBacklog ? Array.from({length: 20}, () => randomUUID()) : [];
  const playing = [ids.Christian, ids.Rosa, ids.Beto, ids.Ana, ids.Leo, ...relatives];
  const next = new Map(playing.map((id, index) => [id, playing[(index + 1) % playing.length]]));
  const key = Buffer.from(process.env.E2E_ASSIGNMENT_ENCRYPTION_KEY!, "base64");
  const pinHash = await hashPin(process.env.E2E_AUTH_SECRET!, "4268");
  const joinedAt = new Date(Date.now() - 7 * 86_400_000);
  await database.db.insert(families).values({id: familyId, name: `Martinez family ${familyId.slice(0, 4)}`});
  await database.db.insert(people).values(names.map((name) => ({familyId, id: ids[name], displayName: name,
    role: name === "Christian" ? "organizer" as const : "member" as const})));
  if (relatives.length) await database.db.insert(people).values(relatives.map((id, index) => ({
    familyId, id, displayName: `Relative ${index + 1}`, role: "member" as const,
  })));
  // Rosa has not opened her key yet, so she has no PIN.
  await database.db.insert(pinCredentials).values([ids.Christian, ids.Ana, ids.Beto, ids.Leo]
    .map((personId) => ({familyId, personId, pinHash, joinedAt, changedAt: joinedAt})));
  await database.db.insert(exchanges).values({familyId, id: exchangeId, name: "Christmas 2026", giftDay: "2026-12-24",
    giftTime: "19:00", place: "Ana's house", budgetAmount: "50", status: drawn ? "drawn" : "open", drawVersion: drawn ? 1 : 0,
    seal: drawn ? drawSeal(key, familyId, exchangeId, 1, next) : null});
  await database.db.insert(participants).values(playing.map((personId) => ({familyId, exchangeId, personId, status: "in" as const})));
  if (drawn) {
    await database.db.insert(drawRuleSnapshots).values({familyId, exchangeId,
      roster: playing.map((id) => ({id, helperId: null, householdId: null})), keepApart: []});
    await database.db.insert(assignments).values(playing.map((giverId) => ({familyId, exchangeId, giverId, version: 1,
      recipientSealed: sealText(key, {familyId, exchangeId, giverId, version: 1, field: "assignment"}, next.get(giverId)!)})));
  }

  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  /** A phone signed in as `name`, with its own device cookie. */
  async function signedIn(name: Name, options: BrowserContextOptions = phone) {
    const token = secret();
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids[name], digest(token), "iphone", new Date()));
    const context = await browser.newContext(options);
    contexts.push(context);
    await context.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-family", value: familyId, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    return {page: await context.newPage(), sessionCookie: session.cookie, sessionId: session.id};
  }
  /** Christian prepares a private first key for `name`. */
  async function keyFor(name: Name, kind: "share" | "reset" = "share") {
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids.Christian, digest(secret()), "iphone", new Date()));
    const organizer = {familyId, personId: ids.Christian, actingAs: ids.Christian, sessionId: session.id, isOrganizer: true};
    const issued = requireIssuedKey(await runForFamily(database.db, familyId, (tx) =>
      issueKey(tx, organizer, ids[name], kind, process.env.E2E_AUTH_SECRET!, new Date())));
    return `${familyId}~${issued.token}`;
  }
  async function sessionsOf(name: Name) {
    return database.db.select().from(sessions).where(and(eq(sessions.familyId, familyId), eq(sessions.personId, ids[name])));
  }
  async function seen(name: Name) {
    const [row] = await database.db.select({version: participants.seenVersion}).from(participants)
      .where(and(eq(participants.familyId, familyId), eq(participants.personId, ids[name])));
    return row?.version ?? null;
  }
  return {familyId, exchangeId, ids, signedIn, keyFor, sessionsOf, seen,
    async version() {
      const [exchange] = await database.db.select({version: exchanges.drawVersion}).from(exchanges)
        .where(and(eq(exchanges.familyId, familyId), eq(exchanges.id, exchangeId)));
      return exchange.version;
    },
    async addRecoveryBacklog() {
      // Persist real disputed openings as the starting state; the browser must run the real repair solver.
      for (const personId of relatives) {
        const [exposed, reporter] = await runForFamily(database.db, familyId, async (tx) => [
          await createSession(tx, familyId, personId, digest(secret()), "iphone", new Date()),
          await createSession(tx, familyId, personId, digest(secret()), "ipad", new Date()),
        ]);
        await database.db.insert(drawOpenings).values({familyId, exchangeId, giverId: personId,
          version: 1, viewerId: personId, sessionId: exposed.id});
        expect(await runForFamily(database.db, familyId, (tx) => disputeSession(tx,
          {familyId, personId, actingAs: personId, sessionId: reporter.id, isOrganizer: false}, exposed.id, new Date()))).toBe(true);
      }
    },
    resolveRecoveryBacklog: () => database.db.update(drawOpenings).set({invalidatedAt: new Date()})
      .where(eq(drawOpenings.familyId, familyId)),
    expireRosa: () => database.db.update(sessions).set({expiresAt: new Date(Date.now() - 1000)})
      .where(and(eq(sessions.familyId, familyId), eq(sessions.personId, ids.Rosa))),
    closeDraw: () => database.db.update(exchanges).set({status: "closed"})
      .where(and(eq(exchanges.familyId, familyId), eq(exchanges.id, exchangeId))),
    async close() {
      await Promise.allSettled(contexts.map((context) => context.close()));
      await database.db.delete(families).where(eq(families.id, familyId));
      await database.close();
    }};
}

/** Waits for arrivals to settle, checks the screen for overflow and axe, then saves it. */
async function shot(page: Page, name: string, checkAccessibility = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"
    || (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity));
  const folder = join(process.env.E2E_EVIDENCE_DIR ?? join(process.cwd(), "test-results", "design"), test.info().project.name);
  mkdirSync(folder, {recursive: true});
  await page.screenshot({path: join(folder, `${name}.png`), fullPage: true});
  // Anything wider than the screen, or text that spills out of its own box. The reveal's loose yarn runs in
  // from past the edge on purpose, inside a stage that clips it, so clipped elements count only as far as shown.
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/hidden|clip/.test(getComputedStyle(parent).overflowX)) return parent.getBoundingClientRect().right <= width + 0.5;
      }
      return false;
    };
    return [...document.querySelectorAll("body *")]
      // (screen-reader-only text sits in a 1px clipped box, so it is clipped too)
      .filter((element) => !clipped(element) && (element.getBoundingClientRect().right > width + 0.5
        // A child's intentional overhang into a card's padding is fine; check text at its own box.
        || (!element.children.length && !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
          && element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 && getComputedStyle(element).overflowX === "visible")))
      .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(0, 120));
  });
  expect(overflow, "nothing runs off the screen").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (checkAccessibility) expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
}

/** Ana opens Rosa's key, chooses "Rosa is here with me", and Rosa makes her PIN: 9.1 and 9.2. */
async function handOver(page: Page, key: string, language: Language, prefix?: string) {
  const t = words(language);
  await page.goto(`/${language}/key/${key}`);
  await expect(page.getByRole("heading", {name: fill(t.helping.keyTitle, {name: "Rosa"})})).toBeVisible();
  if (prefix) await shot(page, `${prefix}-9_1-helping-rosa`);
  await page.getByRole("button", {name: new RegExp(`^${fill(t.helping.hereTitle, {name: "Rosa"})}`)}).click();
  await expect(page.getByRole("heading", {name: `${t.helping.handTitle} Rosa`})).toBeVisible();
  await expect(page.getByText(fill(t.borrowed.handFace, {name: "Rosa"}))).toBeVisible();
  if (prefix) await shot(page, `${prefix}-9_2-hand-to-rosa`);
  await page.getByRole("button", {name: fill(t.helping.handReady, {name: "Rosa"})}).click();
  await expect(page.getByRole("heading", {name: t.getIn.pin.makeTitle})).toBeVisible();
  await typePin(page, "5281");
  await expect(page.getByRole("heading", {name: t.getIn.pin.againTitle})).toBeVisible();
  await typePin(page, "5281");
  await expect(page).toHaveURL(new RegExp(`/${language}/welcome/borrowed$`));
}

for (const language of ["en", "es"] as const) {
  test(`Rosa opens her own person on Ana's signed-in phone, hides it, and the phone goes back to Ana in ${language}`, async ({browser}) => {
    test.setTimeout(120_000);
    const t = words(language);
    const prefix = language === "en" ? "f9" : "f13-es";
    const f = await family(browser);
    try {
      const ana = await f.signedIn("Ana");
      const page = ana.page;
      if (language === "es") await page.emulateMedia({reducedMotion: "reduce"});
      // Ana is at home when she opens the link Christian sent for Rosa.
      await page.goto(`/${language}`);
      const before = await page.evaluate(() => history.length);
      await handOver(page, await f.keyFor("Rosa"), language, prefix);

      // 9.3: Rosa opens the gift; her person knits in on pine. Only she sees it.
      await expect(page.getByRole("heading", {name: t.draw.person.revealReady})).toBeVisible();
      // nothing is opened until Rosa starts on the gift
      expect(await f.seen("Rosa")).toBeNull();
      await page.getByRole("button", {name: t.draw.person.revealTap}).click();
      const hide = page.getByRole("button", {name: fill(t.borrowed.hide, {person: "Beto"})});
      await expect(hide).toBeVisible({timeout: 15_000});
      expect(await f.seen("Rosa")).toBe(1);
      await expect(page.getByText(fill(t.borrowed.handBackLine, {owner: "Ana"}))).toBeVisible();
      await expect(page.getByText(t.getIn.steps.person, {exact: true})).toBeVisible();
      await shot(page, `${prefix}-9_3-on-a-borrowed-phone`);
      if (language === "es") {
        // reduced motion: the gift opens at once, with no long animation left running
        const durations = await page.evaluate(() => document.getAnimations().map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)));
        expect(Math.max(0, ...durations)).toBeLessThanOrEqual(400);
      }

      // 9.4: hidden again, for whoever holds the phone next; the name is gone from the page.
      await hide.click();
      await expect(page.getByRole("heading", {name: `${t.borrowed.backTitle} Ana`})).toBeVisible();
      await expect(page.getByText(fill(t.borrowed.hidden, {name: "Rosa"}))).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Beto");
      await shot(page, `${prefix}-9_4-hand-the-phone-back`);
      // even typed in by hand, the person stays sealed for this phone now
      const sealed = await page.request.get(`/${language}/exchanges/${f.exchangeId}`);
      expect(await sealed.text()).not.toContain("Beto");

      // Ana helps with the sizes and the list, then 9.5.
      await page.getByRole("button", {name: fill(t.borrowed.ownerHas, {owner: "Ana"})}).click();
      await expect(page).toHaveURL(new RegExp(`/${language}/welcome/sizes(?:\\?.*)?$`));
      await page.getByRole("button", {name: t.getIn.sizes.next}).click();
      await expect(page).toHaveURL(new RegExp(`/${language}/welcome/list(?:\\?.*)?$`));
      await page.getByRole("link", {name: t.getIn.add.later}).click();
      await expect(page).toHaveURL(new RegExp(`/${language}/welcome/done(?:\\?.*)?$`));
      await expect(page.getByRole("heading", {name: fill(t.borrowed.doneTitle, {name: "Rosa"})})).toBeVisible();
      await expect(page.getByText(fill(t.borrowed.allDone, {total: 4, owner: "Ana"}))).toBeVisible();
      await expect(page.getByText(fill(t.borrowed.nextTime, {name: "Rosa", organizer: "Christian"}))).toBeVisible();
      await shot(page, `${prefix}-9_5-rosa-all-set`);
      // the whole visit took one entry in the history, the key link's own
      expect(await page.evaluate(() => history.length)).toBe(before + 1);

      await page.getByRole("button", {name: fill(t.borrowed.signOut, {name: "Rosa"})}).click();
      await expect(page).toHaveURL(new RegExp(`/${language}$`));
      // Ana is still signed in, and Rosa's session on her phone is over
      const cookies = await page.context().cookies();
      expect(cookies.find(({name}) => name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
      expect(cookies.find(({name}) => name === "__Host-fge-borrowed")).toBeUndefined();
      const rosaSessions = await f.sessionsOf("Rosa");
      expect(rosaSessions).toHaveLength(1);
      expect(rosaSessions[0]).toMatchObject({lentBySessionId: ana.sessionId, trusted: false});
      expect(rosaSessions[0].revokedAt).not.toBeNull();
      // and Back never returns to Rosa's screens
      await page.goBack();
      expect(new URL(page.url()).pathname).toBe(`/${language}`);
      await expect(page.getByRole("heading", {name: fill(t.borrowed.doneTitle, {name: "Rosa"})})).toHaveCount(0);
      await expect(page.getByText(fill(t.borrowed.hidden, {name: "Rosa"}))).toHaveCount(0);
      await page.goto(`/${language}/account`);
      await expect(page.locator("main")).toContainText("Ana");
      if (language === "en") {
        await page.getByRole("button", {name: en.getIn.you.signOut, exact: true}).click();
        await expect(page).toHaveURL(/\/en\/sign-in$/);
        await expect(page.locator("main")).toContainText("Ana");
        await expect(page.getByRole("link", {name: "Rosa", exact: true})).toHaveCount(0);
        await shot(page, "privacy-remembers-only-the-owner");
      }
    } finally {
      await f.close();
    }
  });
}

test("with no person drawn yet, Rosa only makes her PIN and hands the phone straight back", async ({browser}) => {
  const f = await family(browser, {drawn: false});
  try {
    const {page} = await f.signedIn("Ana");
    await handOver(page, await f.keyFor("Rosa"), "en");
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toBeVisible();
    await expect(page.getByText("Rosa's PIN is made. There's no person to open yet, so nothing was shown.")).toBeVisible();
    const [session] = await f.sessionsOf("Rosa");
    expect(session.personHiddenAt).not.toBeNull();
    await shot(page, "f9-9_4-hand-back-no-person");
  } finally {
    await f.close();
  }
});

test("More sizes cannot lead a borrowed session into My list, Family, or the lender's list", async ({browser}) => {
  const f = await family(browser);
  try {
    const {page} = await f.signedIn("Ana");
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await page.getByRole("button", {name: "Hide Beto"}).click();
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    await page.getByRole("link", {name: en.getIn.sizes.more}).click();
    await expect(page).toHaveURL(/\/en\/welcome\/sizes\/more(?:\?.*)?$/);
    await expect(page.getByRole("link", {name: en.lists.myList, exact: true})).toHaveCount(0);
    await expect(page.getByRole("link", {name: en.ui.tabs.family, exact: true})).toHaveCount(0);
    await shot(page, "privacy-more-sizes-no-list-navigation");
    for (const path of ["lists", "family", `lists/${f.ids.Ana}`, `lists/${f.ids.Rosa}`, "account"]) {
      await page.goto(`/en/${path}`);
      await expect(page).toHaveURL(/\/en\/welcome\/done(?:\?.*)?$/);
      await expect(page.getByRole("button", {name: "Sign Rosa out of this phone"})).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Beto");
    }
  } finally {
    await f.close();
  }
});

test("expired borrowed sizes onboarding returns to Ana before selecting a new list", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await page.getByRole("button", {name: "Hide Beto"}).click();
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    await expect(page).toHaveURL(/\/en\/welcome\/sizes(?:\?.*)?$/);
    const borrowedSessionId = (await f.sessionsOf("Rosa"))[0].id;
    await f.expireRosa();
    await page.getByRole("button", {name: en.getIn.sizes.next}).click();
    await expect(page).toHaveURL(/\/en$/);
    for (const path of ["sizes", "sizes/more", "list", "done"]) {
      await page.goto(`/en/welcome/${path}?borrowed=${borrowedSessionId}`);
      await expect(page).toHaveURL(/\/en$/);
    }
    await page.goto("/en/account");
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find(({name}) => name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
    expect(cookies.find(({name}) => name === "__Host-fge-borrowed")).toBeUndefined();
    await page.goto(`/en/lists/${f.ids.Ana}/profile`);
    await page.getByRole("group", {name: en.lists.size.tops}).getByText("L", {exact: true}).click();
    await expect(page.getByText(en.lists.saved, {exact: true}).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("group", {name: en.lists.size.tops}).getByRole("radio", {name: "L", exact: true})).toBeChecked();
  } finally {
    await f.close();
  }
});

test("closing the exchange before a borrowed reveal still allows hand-back and sign-out", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await f.closeDraw();
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toBeVisible();
    const [session] = await f.sessionsOf("Rosa");
    expect(session.personHiddenAt).not.toBeNull();
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    await page.getByRole("button", {name: en.getIn.sizes.next}).click();
    await page.getByRole("link", {name: en.getIn.add.later}).click();
    await page.getByRole("button", {name: "Sign Rosa out of this phone"}).click();
    await expect(page).toHaveURL(/\/en$/);
    const cookies = await page.context().cookies();
    expect(cookies.find(({name}) => name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
    expect(cookies.find(({name}) => name === "__Host-fge-borrowed")).toBeUndefined();
  } finally {
    await f.close();
  }
});

test("a replacement key, or a key for another family, is still refused on a signed-in phone", async ({browser}) => {
  const f = await family(browser);
  const other = await family(browser);
  try {
    const {page} = await f.signedIn("Ana");
    await handOver(page, await f.keyFor("Rosa"), "en");
    // Rosa now has a PIN; her replacement key is never opened on someone else's phone
    await page.context().clearCookies({name: "__Host-fge-borrowed"});
    await page.goto(`/en/key/${await f.keyFor("Rosa", "reset")}`);
    await expect(page.getByRole("heading", {name: "This key is Rosa's"})).toBeVisible();
    await page.goto(`/en/key/${await other.keyFor("Rosa")}`);
    await expect(page.getByRole("heading", {name: "This key is Rosa's"})).toBeVisible();
  } finally {
    await Promise.all([f.close(), other.close()]);
  }
});

test("the borrowed-phone screens reflow at the largest text size", async ({browser}) => {
  test.setTimeout(120_000);
  const f = await family(browser);
  try {
    const {page} = await f.signedIn("Ana", largest);
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en", "f13-13_5-largest");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(page.getByRole("button", {name: "Hide Beto"})).toBeVisible();
    await shot(page, "f13-13_5-largest-9_3-on-a-borrowed-phone");
    await page.getByRole("button", {name: "Hide Beto"}).click();
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toBeVisible();
    await shot(page, "f13-13_5-largest-9_4-hand-the-phone-back");
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    await expect(page).toHaveURL(/\/en\/welcome\/sizes(?:\?.*)?$/);
    await page.goto("/en/welcome/done");
    await expect(page.getByRole("heading", {name: "Rosa's all set"})).toBeVisible();
    await shot(page, "f13-13_5-largest-9_5-rosa-all-set");
    await page.getByRole("button", {name: "Sign Rosa out of this phone"}).click();
    await expect(page).toHaveURL(/\/en$/);
  } finally {
    await f.close();
  }
});

test("borrowed onboarding saves Rosa's sizes and gift while Ana's own list stays untouched", async ({browser}) => {
  const f = await family(browser);
  try {
    const {page} = await f.signedIn("Ana");
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await page.getByRole("button", {name: "Hide Beto"}).click();
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    const saved = page.waitForResponse(response => response.request().method() === "POST");
    await page.getByRole("group", {name: en.getIn.sizes.tops, exact: true}).getByText("L", {exact: true}).click();
    await saved;
    await page.getByRole("button", {name: en.getIn.sizes.next}).click();
    await page.getByLabel(en.getIn.add.what).fill("Rosa's warm wool scarf");
    await page.getByRole("button", {name: en.getIn.add.add, exact: true}).click();
    await expect(page.getByRole("heading", {name: "Rosa's all set"})).toBeVisible();
    await page.getByRole("button", {name: "Sign Rosa out of this phone"}).click();
    await expect(page).toHaveURL(/\/en$/);
    await page.goto(`/en/lists/${f.ids.Ana}`);
    await expect(page.locator("main")).not.toContainText("Rosa's warm wool scarf");
    await page.goto(`/en/lists/${f.ids.Rosa}`);
    await expect(page.getByRole("heading", {name: "Rosa's warm wool scarf", exact: true})).toBeVisible();
    await shot(page, "privacy-rosa-gift-saved-after-hand-back");
    const rosa = await f.signedIn("Rosa");
    await rosa.page.goto(`/en/lists/${f.ids.Rosa}/profile`);
    await expect(rosa.page.getByRole("group", {name: en.lists.size.tops}).getByRole("radio", {name: "L", exact: true})).toBeChecked();
  } finally { await f.close(); }
});

test("Hide clears an already visible person even when the borrowed session has just expired", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(page.getByRole("button", {name: "Hide Beto"})).toBeVisible();
    await f.expireRosa();
    await page.getByRole("button", {name: "Hide Beto"}).click();
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Beto");
    await shot(page, "privacy-expired-reveal-cleared");
    await page.getByRole("button", {name: "Ana has the phone"}).click();
    await expect(page).toHaveURL(/\/en$/);
    expect((await page.context().cookies()).find(cookie => cookie.name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
  } finally { await f.close(); }
});

test("a redraw while Rosa waits refreshes the borrowed screen and opens the current draw", async ({browser}) => {
  const f = await family(browser);
  try {
    const {page} = await f.signedIn("Ana");
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    const organizer = (await f.signedIn("Christian")).page;
    await organizer.goto(`/en/exchanges/${f.exchangeId}/manage`);
    await organizer.locator("summary").filter({hasText: en.draw.redraw}).click();
    await organizer.getByRole("button", {name: en.draw.confirmDraw, exact: true}).click();
    await expect.poll(f.version).toBe(2);
    const staleAttempt = page.waitForResponse(response => response.request().method() === "POST");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await staleAttempt;
    await expect(page.getByRole("heading", {name: en.draw.person.revealReady})).toBeVisible();
    await expect(page.getByRole("button", {name: en.draw.person.tryAgain})).toHaveCount(0);
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(page.getByRole("button", {name: /^Hide /})).toBeVisible();
    expect(await f.seen("Rosa")).toBe(2);
    await shot(page, "privacy-redraw-current-person-opened");
  } finally { await f.close(); }
});

test("a hidden borrower cannot replace the session using their own replacement key or enroll Face ID", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await page.getByRole("button", {name: "Hide Beto"}).click();
    const borrowedCookie = (await page.context().cookies()).find(cookie => cookie.name === "__Host-fge-borrowed")!.value;
    await page.goto(`/en/key/${await f.keyFor("Rosa", "reset")}`);
    await page.getByRole("button", {name: en.getIn.hello.yes}).click();
    await expect(page.getByRole("heading", {name: en.getIn.pin.makeTitle})).toBeVisible();
    await typePin(page, "6372");
    await expect(page.getByRole("heading", {name: en.getIn.pin.againTitle})).toBeVisible();
    await typePin(page, "6372");
    await expect(page.locator("main").getByRole("alert")).toContainText(en.auth.feedback.otherPerson);
    await shot(page, "privacy-borrower-replacement-refused");
    for (const path of ["face-id", `exchanges/${f.exchangeId}`]) {
      await page.goto(`/en/${path}`);
      await expect(page).toHaveURL(/\/en\/welcome\/done(?:\?.*)?$/);
      await expect(page.getByRole("button", {name: "Sign Rosa out of this phone"})).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Beto");
    }
    await page.goto("/en/sign-in");
    await expect(page.locator("main")).toContainText(en.auth.feedback.otherPerson);
    await expect(page.getByRole("button", {name: /^[0-9]$/})).toHaveCount(0);
    await shot(page, "privacy-borrower-pin-sign-in-refused");
    await page.getByRole("link", {name: en.auth.openAccount}).click();
    await expect(page).toHaveURL(/\/en\/welcome\/done(?:\?.*)?$/);
    const cookies = await page.context().cookies();
    expect(cookies.find(cookie => cookie.name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
    expect(cookies.find(cookie => cookie.name === "__Host-fge-borrowed")?.value).toBe(borrowedCookie);
    expect(await f.sessionsOf("Rosa")).toHaveLength(1);
  } finally { await f.close(); }
});

test("Ana can edit her own sizes directly after expiry even with Rosa's stale cookie", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await f.expireRosa();
    await page.goto(`/en/lists/${f.ids.Ana}/profile`);
    expect((await page.context().cookies()).some(cookie => cookie.name === "__Host-fge-borrowed")).toBe(true);
    await page.getByRole("group", {name: en.lists.size.tops}).getByText("L", {exact: true}).click();
    await expect(page.getByText(en.lists.saved, {exact: true}).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("group", {name: en.lists.size.tops}).getByRole("radio", {name: "L", exact: true})).toBeChecked();
    const cookies = await page.context().cookies();
    expect(cookies.some(cookie => cookie.name === "__Host-fge-borrowed")).toBe(false);
    expect(cookies.find(cookie => cookie.name === "__Host-fge-session")?.value).toBe(ana.sessionCookie);
    await shot(page, "privacy-owner-edit-after-expiry");
  } finally { await f.close(); }
});

test("reporting a compromised lending phone revokes its borrower and repairs Rosa's exposed person", async ({browser}) => {
  const f = await family(browser);
  const freshPhone = await browser.newContext(phone);
  try {
    const stolen = (await f.signedIn("Ana")).page;
    await stolen.emulateMedia({reducedMotion: "reduce"});
    await stolen.goto(`/en/exchanges/${f.exchangeId}`);
    await openPerson(stolen);
    await handOver(stolen, await f.keyFor("Rosa"), "en");
    await stolen.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(stolen.getByRole("button", {name: "Hide Beto"})).toBeVisible();
    const owner = (await f.signedIn("Ana")).page;
    await owner.goto("/en/account");
    const activity = owner.locator("section").filter({has: owner.getByRole("heading", {name: en.auth.revealActivity})});
    await activity.getByRole("button", {name: en.auth.notMe}).click();
    await expect(owner).toHaveURL(/reported=1/);
    expect((await f.sessionsOf("Rosa"))[0].revokedAt).not.toBeNull();
    expect(await f.version()).toBe(2);
    expect(await f.seen("Rosa")).toBeNull();
    await shot(owner, "privacy-lending-phone-disputed");
    await stolen.reload();
    await expect(stolen).toHaveURL(/\/en\/sign-in$/);
    const fresh = await freshPhone.newPage();
    await signInWithPin(fresh, f.familyId, "Rosa", "5281");
    await expect(fresh.locator("main").getByRole("alert")).toContainText(en.getIn.enter.newDevices);
    await shot(fresh, "privacy-disputed-borrower-pin-blocked");
  } finally {
    await freshPhone.close();
    await f.close();
  }
});

test("a real disputed-draw timeout leaves borrowed reveal retryable without handing the phone back", async ({browser}) => {
  test.setTimeout(60_000);
  const f = await family(browser, {recoveryBacklog: true});
  try {
    const {page} = await f.signedIn("Ana");
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await f.addRecoveryBacklog();
    await page.reload();
    await expect(page.locator("main").getByRole("alert")).toContainText(en.borrowed.revealFailed);
    await expect(page.getByRole("button", {name: en.draw.person.tryAgain})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toHaveCount(0);
    expect((await f.sessionsOf("Rosa"))[0].personHiddenAt).toBeNull();
    const timeoutAccessibility = await new AxeBuilder({page}).analyze();
    await test.info().attach("borrowed-timeout-accessibility", {
      body: JSON.stringify(timeoutAccessibility.violations, null, 2), contentType: "application/json",
    });
    // Preserve the accessibility failure, but finish driving privacy and retry before reporting it.
    await shot(page, "privacy-recoverable-draw-timeout", false);
    await f.resolveRecoveryBacklog();
    const refreshed = page.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/en/welcome/borrowed");
    await page.getByRole("button", {name: en.draw.person.tryAgain}).click();
    const response = await refreshed;
    await test.info().attach("borrowed-retry-response", {
      body: await response.body(), contentType: response.headers()["content-type"] ?? "application/octet-stream",
    });
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", {name: en.draw.person.revealReady})).toBeVisible();
    await page.getByRole("button", {name: en.draw.person.revealTap}).click();
    await expect(page.getByRole("button", {name: "Hide Beto"})).toBeVisible();
    expect((await f.sessionsOf("Rosa"))[0].personHiddenAt).toBeNull();
    await shot(page, "privacy-recovered-draw-opened");
    expect.soft(timeoutAccessibility.violations).toEqual([]);
  } finally { await f.close(); }
});

test("a person drawn after the no-person hand-back stays sealed on the borrowed phone", async ({browser}) => {
  const f = await family(browser, {drawn: false});
  try {
    const {page} = await f.signedIn("Ana");
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await expect(page.getByRole("heading", {name: "Hand this phone back to Ana"})).toBeVisible();
    expect((await f.sessionsOf("Rosa"))[0].personHiddenAt).not.toBeNull();
    const organizer = (await f.signedIn("Christian")).page;
    await organizer.emulateMedia({reducedMotion: "reduce"});
    await organizer.goto(`/en/exchanges/${f.exchangeId}/manage/draw`);
    await organizer.getByRole("button", {name: en.draw.drawNames, exact: true}).click();
    await expect.poll(f.version).toBe(1);
    await page.goto(`/en/exchanges/${f.exchangeId}`);
    await expect(page).toHaveURL(/\/en\/welcome\/done(?:\?.*)?$/);
    await expect(page.getByRole("button", {name: "Sign Rosa out of this phone"})).toBeVisible();
    expect(await f.seen("Rosa")).toBeNull();
    await shot(page, "privacy-late-draw-stays-sealed");
  } finally { await f.close(); }
});

test("Ana can preview a gift link after expiry without the stale borrowed cookie sending her Home", async ({browser}) => {
  const f = await family(browser);
  try {
    const ana = await f.signedIn("Ana");
    const {page} = ana;
    await page.emulateMedia({reducedMotion: "reduce"});
    await handOver(page, await f.keyFor("Rosa"), "en");
    await f.expireRosa();
    await page.goto(`/en/lists/${f.ids.Ana}/items/new?kind=link`);
    expect((await page.context().cookies()).some(cookie => cookie.name === "__Host-fge-borrowed")).toBe(true);
    await page.getByLabel(en.lists.url, {exact: true}).fill("https://example.com");
    await page.getByLabel(en.lists.url, {exact: true}).press("Tab");
    await expect(page.getByRole("region", {name: en.lists.previewTitle})).toBeVisible({timeout: 15_000});
    await expect(page).toHaveURL(new RegExp(`/en/lists/${f.ids.Ana}/items/new\\?kind=link$`));
    expect((await page.context().cookies()).some(cookie => cookie.name === "__Host-fge-borrowed")).toBe(false);
    await shot(page, "privacy-owner-preview-after-expiry");
  } finally { await f.close(); }
});
