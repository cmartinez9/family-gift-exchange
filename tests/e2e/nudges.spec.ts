import {mkdirSync, writeFileSync} from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import {hashPin} from "../../src/server/auth/pin";
import {pinCredentials} from "../../src/server/auth/schema";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {aboutMe, exchanges, families, items, outbox, participants, people, sizes} from "../../src/server/db/schema";
import {todayInExchangeCalendar} from "../../src/server/messages/calendar";
import {practiceFamilies} from "../../src/server/draw/schema";
import {listNudges} from "../../src/server/messages/schema";
import {openPerson} from "../helpers/open-person";

// Organizer nudges on Who's in, and the quiet nudge when a giver finds their person's list empty.
// Each new or changed screen is checked with axe and photographed at 390 by 844.
const DIR = process.env.E2E_SCREENSHOT_DIR || "test-results/design";
const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true};
const NAMES = ["Rosa", "Tito", "Ana", "Beto", "Leo"] as const;

test.describe.configure({mode: "serial"});
test.skip(({browserName}) => browserName !== "chromium", "One engine is enough for the screen walk");
test.setTimeout(240_000);

const state: {familyId?: string; exchangeId?: string; ids: Record<string, string>; organizer?: Page; contexts: BrowserContext[]; listAction?: string} = {ids: {}, contexts: []};
const database = () => connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  await page.addStyleTag({content: "nextjs-portal { display: none !important; }"});
  mkdirSync(DIR, {recursive: true});
  await page.screenshot({path: `${DIR}/${name}.png`});
  const {violations} = await new AxeBuilder({page}).exclude("nextjs-portal").analyze();
  expect.soft(violations.map(({id, nodes}) => `${name}: ${id} ${nodes.map(({target}) => target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function memberPage(browser: Browser, baseURL: string, name: string, options: {locale?: string; reducedMotion?: "reduce"} = {}) {
  const db = database();
  try {
    const token = secret();
    const session = await runForFamily(db.db, state.familyId!, (tx) => createSession(tx, state.familyId!, state.ids[name], digest(token), "iphone", new Date()));
    const context = await browser.newContext({...phone, locale: options.locale ?? "en-US", reducedMotion: options.reducedMotion});
    state.contexts.push(context);
    await context.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: baseURL, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: baseURL, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    return context.newPage();
  } finally {
    await db.close();
  }
}

async function rows<T>(read: (db: ReturnType<typeof database>["db"]) => Promise<T>) {
  const db = database();
  try {
    return await read(db.db);
  } finally {
    await db.close();
  }
}

const nudgeNotices = (personId?: string) => rows((db) => db.select().from(outbox).where(and(
  eq(outbox.familyId, state.familyId!), eq(outbox.template, "list-nudge"), personId ? eq(outbox.personId, personId) : undefined,
)));

test.afterAll(async () => {
  await Promise.allSettled(state.contexts.map((context) => context.close()));
  if (!state.familyId) return;
  await rows(async (db) => {
    const practice = await db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, state.familyId!));
    await db.delete(families).where(eq(families.id, state.familyId!));
    for (const row of practice) await db.delete(families).where(eq(families.id, row.practiceFamilyId));
  });
});

test("set up a drawn exchange where Beto and Leo have nothing on their lists", async ({browser}) => {
  const context = await browser.newContext(phone);
  state.contexts.push(context);
  const page = await context.newPage();
  state.organizer = page;
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE ?? process.env.ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill("The Riveras");
  await page.getByLabel("Your name or nickname").fill("Christian");
  await page.getByLabel("4-digit PIN").fill("4268");
  await page.getByLabel("Type the PIN again").fill("4268");
  await page.getByRole("button", {name: "Create my family"}).click();
  await page.getByRole("link", {name: "Not now"}).click();
  await page.getByRole("link", {name: "Start with the exchange"}).click();
  await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
  state.familyId = (await context.cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
  state.exchangeId = page.url().match(/exchanges\/([^/]+)\/manage/)![1];
  await page.getByLabel("Exchange name").fill("Christmas 2026");
  await page.getByLabel("Gift day", {exact: true}).fill("2026-12-24");
  await page.getByLabel("Gift time at the location").fill("19:00");
  await page.getByLabel("Place").fill("Ana’s house");
  await page.getByLabel("Budget in US dollars").fill("50");
  await page.getByLabel("List deadline").fill("2026-12-05");
  await page.getByRole("button", {name: "Next: who’s in"}).click();
  await page.getByLabel("Add a name").fill(NAMES.join(", "));
  await page.getByRole("button", {name: "Add", exact: true}).click();
  for (const name of NAMES) await expect(page.getByRole("checkbox", {name})).toBeChecked();
  await page.getByRole("button", {name: "Next: who lives where"}).click();
  await expect(page.getByRole("heading", {name: "Who lives where?"})).toBeVisible();

  await rows(async (db) => {
    for (const {id, name} of await db.select({id: people.id, name: people.displayName}).from(people).where(eq(people.familyId, state.familyId!))) {
      state.ids[name] = id;
    }
    const family = state.familyId!;
    await db.update(people).set({language: "es"}).where(and(eq(people.familyId, family), eq(people.id, state.ids.Beto)));
    await db.update(people).set({helperId: state.ids.Rosa}).where(and(eq(people.familyId, family), eq(people.id, state.ids.Tito)));
    const pinHash = await hashPin(process.env.E2E_AUTH_SECRET ?? process.env.AUTH_SECRET!, "4268");
    const joinedAt = new Date(Date.now() - 86_400_000);
    await db.insert(pinCredentials).values(["Rosa", "Ana", "Beto"].map((name) => ({familyId: family, personId: state.ids[name], pinHash, joinedAt, changedAt: joinedAt})));
    // ready lists for everyone but Beto (signed up, nothing yet) and Leo (not started)
    const gifts = [
      {title: "Wool hiking socks, 3 pack", store: "REI", price: "27.00"},
      {title: "Cast iron skillet", store: "Walmart", price: "29.88"},
    ];
    for (const name of ["Christian", "Rosa", "Tito", "Ana"]) {
      await db.insert(items).values(gifts.map((gift, position) => ({familyId: family, ownerId: state.ids[name], kind: "note" as const, position, ...gift})));
      await db.insert(sizes).values([["tops", "L"], ["bottoms", "32x32"], ["shoeSystem", "us-men"], ["shoes", "10"]]
        .map(([kind, value]) => ({familyId: family, personId: state.ids[name], kind, value})));
      await db.insert(aboutMe).values({familyId: family, personId: state.ids[name], likes: "grilling and hiking"});
    }
    await db.insert(sizes).values([["tops", "M"], ["shoes", "9"]].map(([kind, value]) => ({familyId: family, personId: state.ids.Beto, kind, value})));
  });
  await page.goto(`/en/exchanges/${state.exchangeId}/manage/draw`);
  await page.getByRole("button", {name: "Draw names"}).click();
  await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible({timeout: 15_000});
});

test("an organizer nudges Beto from Who's in, once a day, without naming anyone", async ({browser, baseURL}) => {
  const page = state.organizer!;
  const whosIn = `/en/exchanges/${state.exchangeId}/manage/people`;
  await page.goto(whosIn);
  await expect(page.getByRole("heading", {name: "Who’s in"})).toBeVisible();
  const row = (name: string) => page.getByRole("listitem").filter({has: page.getByText(name, {exact: true})});
  await expect(row("Tito").getByText("Rosa filled it in")).toBeVisible();
  await expect(row("Beto").getByText("No list yet")).toBeVisible();
  await expect(row("Leo").getByText("Not started")).toBeVisible();
  await expect(page.getByRole("button", {name: /^Nudge /})).toHaveCount(2);
  await expect(row("Leo").getByRole("button", {name: "Nudge Leo", exact: true})).toBeVisible();
  await expect(page.getByText("A nudge is a notice on their phone. It never says who has them.")).toBeVisible();
  await shot(page, "f8-8_3-whos-in-nudge");

  const nudge = page.getByRole("button", {name: "Nudge Beto", exact: true});
  const sentResponse = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
  await nudge.click();
  state.listAction = (await sentResponse).request().headers()["next-action"];
  await expect(page.getByText("Beto will get a nudge")).toBeVisible();
  await expect(row("Beto").getByText("Nudged", {exact: true})).toBeVisible();
  await shot(page, "f8-8_3-whos-in-nudged");

  const sent = await nudgeNotices();
  expect(sent).toMatchObject([{personId: state.ids.Beto, language: "es", requesterName: null}]);
  expect(sent[0].dedupeKey).toMatch(new RegExp(`^list-nudge:${state.exchangeId}:\\d{4}-\\d{2}-\\d{2}$`));
  // the button stays done today, and a second press cannot send another
  await page.reload();
  await expect(row("Beto").getByText("Nudged", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Nudge Beto"})).toHaveCount(0);
  expect(await nudgeNotices()).toHaveLength(1);

  // Beto reads it in Spanish; it never says who asked or who has him
  const beto = await memberPage(browser, baseURL!, "Beto", {locale: "es-US"});
  await beto.goto("/es/notifications");
  await expect(beto.getByRole("heading", {name: "Tu lista de deseos te espera", exact: true})).toBeVisible();
  for (const name of ["Christian", "Rosa", "Ana", "Tito", "Leo"]) await expect(beto.getByRole("main").getByText(name)).toHaveCount(0);
  await shot(beto, "es-beto-list-nudge-notice");

  await page.goto(whosIn.replace("/en/", "/es/"));
  await expect(page.getByText("Un aviso es una notificación en su teléfono. Nunca dice quién le tiene.")).toBeVisible();
  await expect(page.getByText("Avisado", {exact: true})).toBeVisible();
  await shot(page, "es-f8-8_3-whos-in");
});

test("a giver who finds an empty list sees the nudge line, and the daily job sends it later", async ({browser, baseURL, request}) => {
  // start the day over, so the nudge that goes out is the one from this visit
  await rows((db) => db.delete(outbox).where(and(eq(outbox.familyId, state.familyId!), eq(outbox.template, "list-nudge"))));
  await rows((db) => db.delete(listNudges).where(eq(listNudges.familyId, state.familyId!)));
  // find whoever gives to Beto; Beto's list is empty and he has a phone
  let giver: Page | undefined;
  let giverName = "";
  // Always exercise the looked-after giver through their helper's authorized session.
  for (const name of ["Tito", "Christian", "Rosa", "Ana", "Leo"]) {
    const page = name === "Christian" ? state.organizer! : await memberPage(browser, baseURL!, name === "Tito" ? "Rosa" : name);
    if (name === "Tito") {
      await page.goto("/en/account");
      await page.getByRole("button", {name: "Help Tito", exact: true}).click();
      await expect(page).toHaveURL(/\/en\/helping$/);
    }
    await page.goto(`/en/exchanges/${state.exchangeId}`);
    if (await openPerson(page) === "Beto") {
      giver = page;
      giverName = name;
      break;
    }
  }
  expect(giver).toBeDefined();
  const page = giver!;
  await expect(page.getByRole("heading", {name: "Beto hasn’t added anything yet"})).toBeVisible();
  await expect(page.getByText("Ask what they’d like. They won’t know it’s you. We’ll also nudge them.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "f6-6_2-list-is-empty-nudge");

  // the visit records only Beto and the day; the notice waits for the daily job
  const waiting = await rows((db) => db.select().from(listNudges).where(eq(listNudges.familyId, state.familyId!)));
  if (waiting.length) {
    expect(waiting).toMatchObject([{personId: state.ids.Beto, kind: "viewed"}]);
    expect(await nudgeNotices()).toEqual([]);
  }
  // the organizer's board never shows a giver's nudge
  await state.organizer!.goto(`/en/exchanges/${state.exchangeId}/manage/people`);
  await expect(state.organizer!.getByRole("button", {name: "Nudge Beto", exact: true})).toBeVisible();

  expect((await request.get("/api/cron/notifications", {headers: {authorization: `Bearer ${process.env.E2E_CRON_SECRET}`}})).status()).toBe(204);
  const sent = await nudgeNotices();
  expect(sent).toMatchObject([{personId: state.ids.Beto, language: "es", requesterName: null}]);
  expect(JSON.stringify(sent)).not.toContain(state.ids[giverName]);
  expect(await rows((db) => db.select().from(listNudges).where(and(eq(listNudges.familyId, state.familyId!), eq(listNudges.kind, "viewed"))))).toEqual([]);

  await page.goto(`/es/exchanges/${state.exchangeId}`);
  await openPerson(page);
  await expect(page.getByText("Pregúntale qué le gustaría. No sabrá que eres tú. También le enviaremos un aviso.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "es-f6-6_2-list-is-empty-nudge");
  // the largest text size, approximated as 200% zoom of a 390px phone
  await page.goto(`/en/exchanges/${state.exchangeId}`);
  await openPerson(page);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.getByText(/We’ll also nudge them\.$/).scrollIntoViewIfNeeded();
  await expect(page.getByText(/We’ll also nudge them\.$/)).toBeVisible();
  await shot(page, "largest-text-f6-6_2-list-is-empty-nudge");
});

test("reduced motion and the largest text on Who's in", async ({browser, baseURL}) => {
  await rows((db) => db.delete(listNudges).where(eq(listNudges.familyId, state.familyId!)));
  const organizer = await memberPage(browser, baseURL!, "Christian", {reducedMotion: "reduce"});
  await organizer.addInitScript(() => {
    const animate = Element.prototype.animate;
    Object.assign(window, {bellRings: 0});
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      if (this.closest("[data-nudge]")) (window as unknown as {bellRings: number}).bellRings++;
      return animate.apply(this, args);
    };
  });
  await organizer.goto(`/en/exchanges/${state.exchangeId}/manage/people`);
  const nudge = organizer.getByRole("button", {name: "Nudge Beto", exact: true});
  await expect(nudge).toBeVisible();
  // the bell does not ring under reduced motion
  await nudge.click();
  await expect(organizer.getByText("Nudged", {exact: true})).toBeVisible();
  expect(await organizer.evaluate(() => (window as unknown as {bellRings: number}).bellRings)).toBe(0);
  await shot(organizer, "reduced-motion-f8-8_3-whos-in-nudged");
  await organizer.reload();
  await organizer.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await organizer.getByText("Nudged", {exact: true}).scrollIntoViewIfNeeded();
  await expect(organizer.getByText("Christian", {exact: true})).toBeVisible();
  // the name keeps its line: it is not squeezed into a column of single letters
  expect((await organizer.getByText("Christian", {exact: true}).boundingBox())!.height).toBeLessThan(80);
  await shot(organizer, "largest-text-f8-8_3-whos-in");
});

test("bulk reminders keep the organizer response private with two, one, or no unopened people", async ({browser, baseURL}) => {
  const page = state.organizer!;
  const whosIn = `/en/exchanges/${state.exchangeId}/manage/people`;
  const scope = eq(participants.exchangeId, state.exchangeId!);
  const reset = async (unopened: string[]) => rows(async (db) => {
    await db.delete(outbox).where(eq(outbox.familyId, state.familyId!));
    await db.delete(listNudges).where(eq(listNudges.familyId, state.familyId!));
    await db.update(exchanges).set({personNudgedOn: todayInExchangeCalendar(new Date(Date.now() - 86_400_000))}).where(eq(exchanges.id, state.exchangeId!));
    await db.update(participants).set({seenVersion: 1}).where(scope);
    for (const name of unopened) await db.update(participants).set({seenVersion: null}).where(and(scope, eq(participants.personId, state.ids[name])));
  });
  const transcript: unknown[] = [];
  let action: {id: string; body: string} | undefined;
  let initialBoard: string[] | undefined;
  let initialResponse: string | undefined;
  for (const unopened of [["Rosa", "Beto"], ["Rosa"], []]) {
    await reset(unopened);
    await page.goto(whosIn);
    const board = await page.getByRole("listitem").allTextContents();
    initialBoard ??= board;
    expect(board).toEqual(initialBoard);
    const controls = await page.getByRole("button", {name: /^Nudge /}).allTextContents();
    expect(controls).toEqual(["Nudge", "Nudge"]);
    const send = async () => {
      const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
      await page.getByRole("button", {name: "Remind people to open their person", exact: true}).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const body = await response.text();
      expect(body).toMatch(/\n\d+:"sent"\n/);
      action = {id: response.request().headers()["next-action"], body: response.request().postData()!};
      await expect(page.getByText("Reminders sent", {exact: true})).toBeVisible();
      return body;
    };
    const first = await send();
    initialResponse ??= first;
    expect(first).toBe(initialResponse);
    const startedListResponse = await page.request.post(whosIn, {
      headers: {"next-action": state.listAction!, origin: baseURL!, "content-type": "text/plain;charset=UTF-8"},
      data: JSON.stringify([state.exchangeId, state.ids.Rosa]),
    });
    expect(await startedListResponse.text()).toMatch(/\n\d+:"unavailable"\n/);
    const notices = () => rows((db) => db.select().from(outbox).where(eq(outbox.familyId, state.familyId!)));
    expect((await notices()).map(({personId}) => personId).sort()).toEqual(unopened.map((name) => state.ids[name]).sort());
    expect((await notices()).every(({template, requesterName}) => template === "person-nudge" && requesterName === null)).toBe(true);
    // A participant becomes unopened after the batch: a repeat must neither reveal it nor send again.
    await rows((db) => db.update(participants).set({seenVersion: null}).where(and(scope, eq(participants.personId, state.ids.Ana))));
    const repeated = await send();
    expect(repeated).toBe(first);
    expect(await notices()).toHaveLength(unopened.length);
    await page.reload();
    expect(await page.getByRole("listitem").allTextContents()).toEqual(board);
    expect(await page.getByRole("button", {name: /^Nudge /}).allTextContents()).toEqual(controls);
    transcript.push({unopenedCount: unopened.length, firstResponse: first, repeatedResponse: repeated, startedListResponse: "unavailable", persistedNoticeCount: (await notices()).length, boardUnchanged: true});
    if (unopened.length === 2) {
      await page.getByRole("button", {name: "Remind people to open their person", exact: true}).scrollIntoViewIfNeeded();
      await shot(page, "bulk-reminder-organizer-en");
      for (const [name, language, title] of [["Rosa", "en", "Your person is waiting"], ["Beto", "es", "Tu persona te espera"]]) {
        const member = await memberPage(browser, baseURL!, name, {locale: language});
        await member.goto(`/${language}/notifications`);
        const notice = member.getByRole("listitem").filter({has: member.getByRole("heading", {name: title, exact: true})});
        await expect(notice).toBeVisible();
        for (const identity of [...NAMES, "Christian", ...Object.values(state.ids)]) await expect(notice).not.toContainText(identity);
        await shot(member, `bulk-reminder-notice-${language}`);
      }
    }
  }
  // Replay the actual browser action as an ordinary participant. No domain function is stubbed.
  const member = await memberPage(browser, baseURL!, "Rosa");
  const forbidden = await member.request.post(whosIn, {headers: {"next-action": action!.id, origin: baseURL!, "content-type": "text/plain;charset=UTF-8"}, data: action!.body});
  expect(await forbidden.text()).toMatch(/\n\d+:"forbidden"\n/);
  await member.goto(whosIn);
  await expect(member.getByRole("button", {name: "Remind people to open their person", exact: true})).toHaveCount(0);
  transcript.push({ordinaryMemberAction: "forbidden", ordinaryMemberHasOrganizerControl: false});
  for (const [status, drawVersion] of [["closed", 1], ["open", 0]] as const) {
    await rows((db) => db.update(exchanges).set({status, drawVersion}).where(eq(exchanges.id, state.exchangeId!)));
    const response = await page.request.post(whosIn, {
      headers: {"next-action": action!.id, origin: baseURL!, "content-type": "text/plain;charset=UTF-8"}, data: action!.body,
    });
    expect(await response.text()).toMatch(/\n\d+:"unavailable"\n/);
    transcript.push({exchangeStatus: status, drawVersion, staleOrganizerAction: "unavailable"});
  }
  await rows((db) => db.update(exchanges).set({status: "locked", drawVersion: 1}).where(eq(exchanges.id, state.exchangeId!)));
  await page.goto(whosIn.replace("/en/", "/es/"));
  await page.getByRole("button", {name: "Recordar que descubran a su persona", exact: true}).click();
  await expect(page.getByText("Avisos enviados", {exact: true})).toBeVisible();
  await shot(page, "bulk-reminder-organizer-es");
  mkdirSync(DIR, {recursive: true});
  writeFileSync(`${DIR}/bulk-reminder-http.json`, JSON.stringify(transcript, null, 2));
});

test("Not started nudges persist until joining and refresh on an open organizer page", async ({browser, baseURL}) => {
  const today = todayInExchangeCalendar(new Date());
  const yesterday = todayInExchangeCalendar(new Date(Date.now() - 86_400_000));
  await rows(async (db) => {
    await db.delete(outbox).where(eq(outbox.familyId, state.familyId!));
    await db.delete(listNudges).where(eq(listNudges.familyId, state.familyId!));
    await db.insert(listNudges).values({familyId: state.familyId!, exchangeId: state.exchangeId!, personId: state.ids.Leo, kind: "organizer", day: yesterday});
  });
  const page = state.organizer!;
  const whosIn = `/en/exchanges/${state.exchangeId}/manage/people`;
  const row = page.getByRole("listitem").filter({has: page.getByText("Leo", {exact: true})});
  await page.goto(whosIn);
  await expect(row.getByText("Not started", {exact: true})).toBeVisible();
  await row.getByRole("button", {name: "Nudge Leo", exact: true}).click();
  await expect(row.getByText("Nudged", {exact: true})).toBeVisible();
  expect((await rows((db) => db.select().from(listNudges).where(and(eq(listNudges.familyId, state.familyId!), eq(listNudges.personId, state.ids.Leo))))).map(({day}) => day)).toEqual([today]);
  await rows(async (db) => {
    const pinHash = await hashPin(process.env.E2E_AUTH_SECRET ?? process.env.AUTH_SECRET!, "4268");
    await db.insert(pinCredentials).values({familyId: state.familyId!, personId: state.ids.Leo, pinHash, joinedAt: new Date()});
  });
  const leo = await memberPage(browser, baseURL!, "Leo");
  await leo.goto("/en/notifications");
  await expect(leo.getByRole("heading", {name: "Your wishlist is waiting", exact: true})).toBeVisible();
  await shot(leo, "not-started-nudge-after-joining");

  // A second organizer page sends today's nudge; focusing the mounted page fetches fresh props.
  const other = await memberPage(browser, baseURL!, "Christian");
  await other.goto(whosIn);
  await other.getByRole("button", {name: "Nudge Beto", exact: true}).click();
  await expect(other.getByText("Beto will get a nudge")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const beto = page.getByRole("listitem").filter({has: page.getByText("Beto", {exact: true})});
  await expect(beto.getByText("Nudged", {exact: true})).toBeVisible();
  await rows((db) => db.delete(listNudges).where(and(eq(listNudges.familyId, state.familyId!), eq(listNudges.personId, state.ids.Beto))));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(beto.getByRole("button", {name: "Nudge Beto", exact: true})).toBeVisible();

  // Only the browser clock changes: the running product must release its mounted completion at Chicago midnight.
  let midnight = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
  while (todayInExchangeCalendar(new Date(midnight)) === today) midnight += 3_600_000;
  await page.clock.setFixedTime(new Date(midnight - 30_000));
  await expect(row.getByText("Nudged", {exact: true})).toBeVisible();
  await page.clock.setFixedTime(new Date(midnight + 1000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(row.getByRole("button", {name: "Nudge Leo", exact: true})).toBeVisible();
  await shot(page, "mounted-nudge-reset-next-calendar-day");
  writeFileSync(`${DIR}/nudge-calendar-refresh.json`, JSON.stringify({
    storedPreviousDay: yesterday, acceptedOn: today, previousDayRemoved: true, noticeVisibleAfterJoining: true,
    mountedPageHonoredServerNudged: true, mountedPageHonoredServerReady: true, clientMidnightReleasedCompletion: true,
  }, null, 2));
});
