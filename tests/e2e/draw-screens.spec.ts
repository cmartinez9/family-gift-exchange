import {mkdirSync} from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContext, type Locator, type Page} from "@playwright/test";
import {and, eq, inArray} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {aboutMe, families, households, items, people, sizes} from "../../src/server/db/schema";
import {pinCredentials, pinResetRequests} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {practiceFamilies} from "../../src/server/draw/schema";

// Walks the organizer's setup and draw, the season, and each member's person, on the Sweater Weather
// screens, at 390 by 844. Every screen is checked with axe and photographed into test-results/design.
const DIR = process.env.E2E_SCREENSHOT_DIR || "test-results/design";
const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true};
const NAMES = ["Rosa", "Tito", "Ana", "Beto", "Leo"] as const;

async function closeKeyOverlayWithKeyboard(page: Page, opener: Locator) {
  const dialog = page.getByRole("dialog", {name: "Send keys"});
  await expect(dialog.getByRole("button", {name: "Send keys", exact: true})).toBeFocused();
  const focusHistory = [];
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    const focus = await dialog.evaluate((element) => ({
      inDialog: element.contains(document.activeElement),
      activeTag: document.activeElement?.tagName,
      activeText: document.activeElement?.textContent?.slice(0, 100),
      hasFocus: document.hasFocus(),
    }));
    focusHistory.push({key, ...focus});
    // Native modal dialogs allow Tab into browser chrome, but covered page controls stay inert.
    expect(focus.inDialog || (focus.activeTag === "BODY" && !focus.hasFocus), JSON.stringify(focus)).toBe(true);
  }
  await test.info().attach("key-overlay-keyboard-focus", {body: JSON.stringify(focusHistory), contentType: "application/json"});
  await page.locator("#family-address").focus();
  await expect(page.locator("#family-address")).not.toBeFocused();
  await page.getByRole("link", {name: "Tell the family", exact: true}).focus();
  await expect(page.getByRole("link", {name: "Tell the family", exact: true})).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

test.describe.configure({mode: "serial"});
test.skip(({browserName}) => browserName !== "chromium", "One engine is enough for the screen walk");
test.setTimeout(300_000);

async function shot(page: Page, name: string, {axe = true} = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // let arrivals and knitting settle
  await page.waitForTimeout(700);
  // the development build's own badge is not part of the screen
  await page.addStyleTag({content: "nextjs-portal { display: none !important; }"});
  mkdirSync(DIR, {recursive: true});
  await page.screenshot({path: `${DIR}/${name}.png`});
  if (axe) {
    const {violations} = await new AxeBuilder({page}).exclude("nextjs-portal").analyze();
    expect.soft(violations.map(({id, nodes}) => `${name}: ${id} ${nodes.map(({target}) => target.join(" ")).join(", ")}`)).toEqual([]);
  }
}

const state: {familyId?: string; exchangeId?: string; ids: Record<string, string>; organizer?: Page; contexts: BrowserContext[]} = {ids: {}, contexts: []};
const database = () => connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);

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

test.afterAll(async () => {
  await Promise.allSettled(state.contexts.map((context) => context.close()));
  if (!state.familyId) return;
  const db = database();
  try {
    const practice = await db.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, state.familyId));
    await db.db.delete(families).where(eq(families.id, state.familyId));
    for (const row of practice) await db.db.delete(families).where(eq(families.id, row.practiceFamilyId));
  } finally {
    await db.close();
  }
});

test("setup: the exchange, who's in, who lives where, and the draw", async ({browser, baseURL}) => {
  const context = await browser.newContext(phone);
  state.contexts.push(context);
  const page = await context.newPage();
  state.organizer = page;
  await page.goto("/en/start");
  await expect(page.getByRole("heading", {name: "Run your family’s gift exchange"})).toBeVisible();
  await shot(page, "f7-7_1-start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE ?? process.env.ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill("The Riveras");
  await page.getByLabel("Your name or nickname").fill("Christian");
  await page.getByLabel("4-digit PIN").fill("4268");
  await page.getByLabel("Type the PIN again").fill("4268");
  await page.getByRole("button", {name: "Create my family"}).click();
  await page.getByRole("link", {name: "Not now"}).click();
  await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
  const session = (await context.cookies()).find(({name}) => name === "__Host-fge-session")!;
  state.familyId = session.value.split(".")[0];

  state.exchangeId = page.url().match(/exchanges\/([^/]+)\/manage/)![1];
  await page.getByLabel("Exchange name").fill("Christmas 2026");
  await page.getByLabel("Gift day", {exact: true}).fill("2026-12-24");
  await page.getByLabel("Gift time at the location").fill("19:00");
  await page.getByLabel("Place").fill("Ana’s house");
  await page.getByLabel("Budget in US dollars").fill("50");
  await page.getByLabel("List deadline").fill("2026-12-05");
  await shot(page, "f7-7_4-the-exchange");
  await page.getByRole("button", {name: "Next: who’s in"}).click();

  await expect(page.getByRole("heading", {name: "Who’s in?"})).toBeVisible();
  await page.getByLabel("Add a name").fill(NAMES.join(", "));
  await page.getByRole("button", {name: "Add", exact: true}).click();
  for (const name of NAMES) await expect(page.getByRole("checkbox", {name})).toBeChecked();
  await shot(page, "f7-7_5-whos-in");

  const db = database();
  try {
    const rows = await db.db.select({id: people.id, name: people.displayName}).from(people).where(eq(people.familyId, state.familyId));
    for (const {id, name} of rows) state.ids[name] = id;
    const [one, two, three] = await db.db.insert(households).values(["House 1", "House 2", "House 3"].map((name) => ({familyId: state.familyId!, name})))
      .returning({id: households.id});
    // four of six in one house: the draw cannot be fair yet
    await db.db.update(people).set({householdId: two.id}).where(and(eq(people.familyId, state.familyId),
      inArray(people.id, ["Rosa", "Ana", "Beto", "Leo"].map((name) => state.ids[name]))));
    await page.getByRole("button", {name: "Next: who lives where"}).click();
    await expect(page.getByRole("heading", {name: "Who lives where?"})).toBeVisible();
    await page.goto(`/en/exchanges/${state.exchangeId}/manage/draw`);
    await expect(page.getByRole("heading", {name: "Not ready to draw yet"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Draw names"})).toBeDisabled();
    await shot(page, "f7-7_7-not-ready");

    await db.db.update(people).set({householdId: one.id}).where(and(eq(people.familyId, state.familyId),
      inArray(people.id, [state.ids.Rosa, state.ids.Tito])));
    await db.db.update(people).set({householdId: three.id}).where(and(eq(people.familyId, state.familyId), eq(people.id, state.ids.Christian)));
    await db.db.update(people).set({helperId: state.ids.Rosa}).where(and(eq(people.familyId, state.familyId), eq(people.id, state.ids.Tito)));
    await db.db.update(people).set({helperId: state.ids.Ana}).where(and(eq(people.familyId, state.familyId), eq(people.id, state.ids.Leo)));
    // lists, sizes and likes for everyone but Leo, whose list stays empty
    const gifts = [
      {title: "Wool hiking socks, 3 pack", store: "REI", price: "27.00"},
      {title: "Wireless earbuds", store: "Best Buy", price: "79.99"},
      {title: "Cast iron skillet", store: "Walmart", price: "29.88", note: "The 12 inch one"},
    ];
    for (const name of ["Rosa", "Tito", "Ana", "Beto", "Christian"]) {
      await db.db.insert(items).values(gifts.map((gift, position) => ({familyId: state.familyId!, ownerId: state.ids[name], kind: "note" as const, position, ...gift})));
      await db.db.insert(sizes).values([["tops", "L"], ["bottoms", "32x32"], ["shoeSystem", "us-men"], ["shoes", "10"]]
        .map(([kind, value]) => ({familyId: state.familyId!, personId: state.ids[name], kind, value})));
      await db.db.insert(aboutMe).values({familyId: state.familyId!, personId: state.ids[name], likes: "grilling and hiking"});
    }
  } finally {
    await db.close();
  }
  await page.goto("/en/family");
  await expect(page.getByText("Looked after by Rosa")).toBeVisible();
  await shot(page, "f7-7_6-who-lives-where");
  await page.getByRole("link", {name: "Next: draw names"}).click();
  await expect(page.getByRole("heading", {name: "Ready to draw"})).toBeVisible();
  await shot(page, "f7-7_8-ready-to-draw");

  await page.getByRole("button", {name: "Draw names"}).click();
  await expect(page.getByRole("heading", {name: "Winding one loop through everyone"})).toBeVisible();
  await page.waitForTimeout(1500);
  await page.addStyleTag({content: "nextjs-portal { display: none !important; }"});
  await page.screenshot({path: `${DIR}/f7-7_9-winding-one-loop.png`});
  await expect(page.getByRole("heading", {name: "Knitting it closed"})).toBeVisible({timeout: 5000});
  await page.waitForTimeout(900);
  await page.screenshot({path: `${DIR}/f7-7_10-knitting-it-closed.png`});
  await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible({timeout: 8000});
  await expect(page.getByText(/^Seal code [A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
  await shot(page, "f7-7_11-names-are-drawn");
  void baseURL;
});

test("send keys, show a code, print cards, tell the family", async () => {
  const page = state.organizer!;
  await page.getByRole("link", {name: "Next: send the keys"}).click();
  await expect(page.getByRole("heading", {name: "Send keys"})).toBeVisible();
  await expect(page.getByText("No phone · Rosa helps")).toBeVisible();
  await shot(page, "f7-7_12-send-keys");
  const ana = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Ana", exact: true})});
  await ana.getByRole("button", {name: "Send", exact: true}).click();
  await expect(ana.getByText(/^Hi Ana! This is your private key/)).toBeVisible();
  await shot(page, "f7-7_13-send-ana-her-key");
  const qrOpener = page.getByRole("button", {name: "Show QR", exact: true}).last();
  await qrOpener.click();
  await expect(page.getByRole("img", {name: "Scan to open your private key"}).last()).toBeVisible();
  await shot(page, "f7-7_14-show-the-key");
  await closeKeyOverlayWithKeyboard(page, qrOpener);
  const printOpener = page.getByRole("button", {name: "Print cards"});
  await printOpener.click();
  await expect(page.getByRole("heading", {name: "Print key cards"})).toBeVisible();
  await expect(page.getByRole("dialog", {name: "Send keys"}).getByRole("button", {name: "Send keys", exact: true})).toBeFocused();
  await expect(page.getByRole("img", {name: "Scan to open your private key"})).toHaveCount(3);
  await shot(page, "f7-7_15-print-key-cards");
  await page.emulateMedia({media: "print"});
  const printed = page.getByRole("dialog", {name: "Send keys"}).getByRole("img", {name: "Scan to open your private key"});
  await expect(printed).toHaveCount(3);
  for (const card of await printed.all()) await expect(card).toBeVisible();
  await page.emulateMedia({media: "screen"});
  // Print media hid the focused back button; resume the keyboard check inside the dialog.
  await page.getByRole("dialog", {name: "Send keys"}).getByRole("button", {name: "Send keys", exact: true}).focus();
  await closeKeyOverlayWithKeyboard(page, printOpener);
  await page.getByRole("link", {name: "Tell the family"}).click();
  await expect(page.getByRole("region", {name: "Names are drawn!"})).toBeVisible();
  await shot(page, "f7-7_16-tell-the-family");
});

test("the practice family and preview as someone", async () => {
  const page = state.organizer!;
  await page.goto("/en/exchanges/practice");
  await page.getByRole("button", {name: "Start practice"}).click();
  await expect(page.getByRole("button", {name: "Draw names", exact: true})).toBeVisible();
  await shot(page, "f7-7_2-practice-family");
  await page.goto(`/en/exchanges/${state.exchangeId}/manage`);
  await page.locator("summary").filter({hasText: /^Preview as a member$/}).click();
  await page.getByRole("combobox", {name: "Person", exact: true}).selectOption({label: "Rosa"});
  await page.getByRole("button", {name: "Open preview"}).click();
  await expect(page.getByRole("heading", {name: "Preview as Rosa"})).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await shot(page, "f7-7_3-preview-as-rosa");
});

test("during the season: the hub, who's in, a PIN reset, a dropout and a late joiner", async () => {
  const page = state.organizer!;
  const db = database();
  try {
    const pinHash = await hashPin(process.env.E2E_AUTH_SECRET ?? process.env.AUTH_SECRET!, "4268");
    const joinedAt = new Date(Date.now() - 86_400_000);
    await db.db.insert(pinCredentials).values(["Rosa", "Ana"].map((name) => ({familyId: state.familyId!, personId: state.ids[name], pinHash, joinedAt, changedAt: joinedAt})));
    await db.db.insert(pinResetRequests).values({familyId: state.familyId!, personId: state.ids.Rosa, deviceKind: "iphone"});
    const [marta] = await db.db.insert(people).values({familyId: state.familyId!, displayName: "Marta"}).returning({id: people.id});
    state.ids.Marta = marta.id;
  } finally {
    await db.close();
  }
  await page.goto(`/en/exchanges/${state.exchangeId}/manage`);
  await expect(page.getByRole("heading", {name: "Christmas 2026"})).toBeVisible();
  await shot(page, "f8-8_2-running-christmas");
  await page.getByRole("link", {name: /^Who’s in/}).click();
  await expect(page.getByRole("heading", {name: "Who’s in"})).toBeVisible();
  await shot(page, "f8-8_3-whos-in");
  await page.goto("/en/family/keys");
  const rosa = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Rosa", exact: true})});
  await rosa.getByRole("button", {name: "Reset PIN"}).click();
  await expect(page.getByRole("heading", {name: "Reset Rosa’s PIN?"})).toBeVisible();
  await shot(page, "f8-8_4-reset-rosas-pin");
  await page.keyboard.press("Escape");
  await page.goto(`/en/exchanges/${state.exchangeId}/manage`);
  await page.locator("summary").filter({hasText: /^Dropouts and late joiners$/}).click();
  await page.getByRole("button", {name: "Beto can’t take part"}).click();
  await expect(page.getByRole("heading", {name: "Beto can’t take part this year?"})).toBeVisible();
  await shot(page, "f8-8_5-beto-cant-take-part");
  await page.getByRole("button", {name: "Keep Beto in"}).click();
  await page.getByRole("button", {name: "Add Marta to the draw"}).click();
  await expect(page.getByRole("heading", {name: "Add Marta to the draw?"})).toBeVisible();
  await shot(page, "f8-8_6-marta-wants-in");
  await page.keyboard.press("Escape");
  await page.goto(`/es/exchanges/${state.exchangeId}/manage`);
  await expect(page.getByRole("heading", {name: "Christmas 2026"})).toBeVisible();
  await shot(page, "es-f8-8_2-running-christmas");
});

test("your person: the reveal, their page, asking, answering and something wrong", async ({browser, baseURL}) => {
  const member = `/en/exchanges/${state.exchangeId}`;
  const pages: Record<string, Page> = {};
  const recipients: Record<string, string> = {};
  // Tito and Leo have no phone of their own; the others open their person here
  for (const name of ["Rosa", "Ana", "Beto"]) {
    const page = await memberPage(browser, baseURL!, name);
    pages[name] = page;
    await page.goto(member);
    if (name === "Rosa") {
      await expect(page.getByRole("heading", {name: "Your person is ready"})).toBeVisible();
      await shot(page, "f6-reveal-1-ready");
    }
    await page.getByRole("button", {name: "Or tap here to open it"}).click();
    const see = page.getByRole("button", {name: /^See .+’s page$/});
    await expect(see).toBeVisible({timeout: 10_000});
    if (name === "Rosa") {
      await page.waitForTimeout(1200);
      await page.screenshot({path: `${DIR}/f6-reveal-2-revealed.png`});
    }
    recipients[name] = (await see.innerText()).replace(/^See /, "").replace(/’s page$/, "");
    await see.click();
    await expect(page.getByRole("heading", {level: 1, name: `You’re giving to ${recipients[name]}`})).toBeVisible();
  }
  // the asker's person can answer on a phone; another giver's person gets an empty list
  const giver = Object.keys(recipients).find((name) => !["Tito", "Leo"].includes(recipients[name]))!;
  const emptyGiver = Object.keys(recipients).find((name) => name !== giver)!;
  const db = database();
  try {
    await db.db.delete(items).where(and(eq(items.familyId, state.familyId!), eq(items.ownerId, state.ids[recipients[emptyGiver]])));
  } finally {
    await db.close();
  }
  const page = pages[giver];
  await expect(page.getByText("Wool hiking socks, 3 pack")).toBeVisible();
  await shot(page, "f6-6_1-your-person");
  await pages[emptyGiver].goto(member);
  await pages[emptyGiver].getByRole("button", {name: "Open your person"}).click();
  await expect(pages[emptyGiver].getByRole("heading", {name: `${recipients[emptyGiver]} hasn’t added anything yet`})).toBeVisible();
  await shot(pages[emptyGiver], "f6-6_2-list-is-empty");
  const person = recipients[giver];
  await page.getByRole("button", {name: `Ask ${person} a question`}).click();
  await page.getByRole("button", {name: "Which color?"}).click();
  await expect(page.getByLabel("Your anonymous question")).toHaveValue("Which color would you like?");
  await page.getByLabel("Your anonymous question").fill("Which color skillet would you like, black or red?");
  await shot(page, "f6-6_3-ask");
  await page.getByRole("button", {name: "Send my question"}).click();
  await expect(page.getByText(`Sent to ${person}`)).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "f6-6_4-asked");

  const answerer = pages[person] ?? await memberPage(browser, baseURL!, person);
  await answerer.goto(member);
  // Before someone opens their own person, the question is in a banner with an Answer link.
  await answerer.getByRole("link", {name: /A question for you/})
    .or(answerer.getByRole("link", {name: "Answer", exact: true})).click();
  await expect(answerer.getByText("Which color skillet would you like, black or red?")).toBeVisible();
  await shot(answerer, "f6-6_6-a-question-for-you");
  await answerer.getByLabel("Your answer").fill("Black, please. The red ones chip.");
  await answerer.getByRole("button", {name: "Send my answer"}).click();
  await expect(answerer.getByText("You’ve answered.")).toBeVisible();

  await page.goto(member);
  await page.getByRole("button", {name: "Open your person"}).click();
  await expect(page.getByText(`${person} answered`)).toBeVisible();
  await shot(page, "f6-6_5-answered");
  await page.goto(member.replace("/en/", "/es/"));
  await page.getByRole("button", {name: "Descubrir a tu persona"}).click();
  await expect(page.getByText(`${person} respondió`)).toBeVisible();
  await shot(page, "es-f6-6_5-answered");

  await page.goto(member);
  await page.getByRole("button", {name: "Open your person"}).click();
  await page.getByRole("button", {name: "Something wrong?"}).click();
  await expect(page.getByRole("heading", {name: `Can’t give to ${person}?`})).toBeVisible();
  await shot(page, "f6-6_7-cant-give");
  await page.getByRole("button", {name: "Get a new person"}).click();
  await expect(page.getByRole("heading", {name: "Fixing it quietly"})).toBeVisible();
  await shot(page, "f6-6_8-fixing-it-quietly");
  await page.getByRole("link", {name: "Open my new person"}).click();
  await expect(page.getByRole("heading", {name: "Your person is ready"})).toBeVisible();
});

test("reduced motion and the largest text", async ({browser, baseURL}) => {
  const reduced = await memberPage(browser, baseURL!, "Christian", {reducedMotion: "reduce"});
  await reduced.goto(`/en/exchanges/${state.exchangeId}`);
  await reduced.getByRole("button", {name: "Or tap here to open it"}).click();
  await expect(reduced.getByRole("button", {name: /^See .+’s page$/})).toBeVisible();
  await shot(reduced, "reduced-motion-reveal-opens-at-once");
  const large = state.organizer!;
  await large.goto(`/en/exchanges/${state.exchangeId}/manage`);
  // the largest text size, approximated as 200% zoom of a 390px phone
  await large.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(large.getByRole("heading", {name: "Christmas 2026"})).toBeVisible();
  expect(await large.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(large, "largest-text-running-christmas");
});
