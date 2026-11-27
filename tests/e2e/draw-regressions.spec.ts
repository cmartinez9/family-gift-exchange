import {expect, test, type Page, type TestInfo} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {and, count, eq, isNull} from "drizzle-orm";
import {Client} from "pg";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, items, participants, people} from "../../src/server/db/schema";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {practiceFamilies} from "../../src/server/draw/schema";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {openKey} from "../helpers/pin-pad";

test.setTimeout(120_000);
const database = () => connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);

async function capture(page: Page, info: TestInfo, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({path, fullPage});
  await info.attach(name, {path, contentType: "image/png"});
}

async function create(page: Page) {
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill("Snowfall Christmas");
  await page.getByLabel("Your name or nickname").fill("Organizer");
  await page.getByLabel("4-digit PIN").fill("4268");
  await page.getByLabel("Type the PIN again").fill("4268");
  await page.getByRole("button", {name: "Create my family"}).click();
  await page.getByRole("link", {name: "Not now"}).click();
  await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
  const familyId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
  return {familyId, manage: page.url(), exchangeId: page.url().match(/exchanges\/([^/]+)/)![1]};
}

async function cleanup(familyId: string) {
  const db = database();
  try {
    const practice = await db.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, familyId));
    await db.db.delete(families).where(eq(families.id, familyId));
    for (const row of practice) await db.db.delete(families).where(eq(families.id, row.practiceFamilyId));
  } finally { await db.close(); }
}

async function add(page: Page, names: string) {
  await page.getByLabel("Add a name").fill(names);
  await page.getByRole("button", {name: "Add", exact: true}).click();
}

for (const drawn of [false, true]) {
  test(`closed ${drawn ? "drawn" : "undrawn"} exchange shows saved facts instead of management editors in both languages`, async ({page}, info) => {
    const family = await create(page);
    try {
      await page.getByLabel("Gift day", {exact: true}).fill("2026-12-24");
      await page.getByLabel("Gift time at the location").fill("19:30");
      await page.getByLabel("Place").fill("Community Hall");
      await page.getByLabel("List deadline").fill("2026-12-05");
      await page.getByRole("button", {name: en.draw.setup.nextPeople, exact: true}).click();
      await add(page, "Alex, Blake, Casey");
      await expect(page.getByRole("checkbox", {name: "Casey", exact: true})).toBeChecked();
      if (drawn) {
        await page.getByRole("button", {name: en.draw.setup.nextHouses, exact: true}).click();
        await page.getByRole("link", {name: en.draw.setup.nextDraw, exact: true}).click();
        await page.getByRole("button", {name: "Draw names", exact: true}).click();
        await page.getByRole("button", {name: "Skip the animation"}).click();
        await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible();
      }
      await page.goto(`${family.manage}/details`);
      await expect(page.getByLabel(en.draw.place, {exact: true})).toHaveValue("Community Hall");
      await page.getByLabel(en.draw.place, {exact: true}).fill("Winter Community Hall");
      await page.getByRole("button", {name: en.draw.saveDetails, exact: true}).click();
      await expect(page.getByRole("status")).toContainText(en.draw.detailsSaved);
      await page.reload();
      await expect(page.getByLabel(en.draw.place, {exact: true})).toHaveValue("Winter Community Hall");
      await page.goto(`${family.manage}/people`);
      if (drawn) await expect(page.getByRole("heading", {name: en.draw.season.whosIn, exact: true})).toBeVisible();
      else await expect(page.getByRole("checkbox")).toHaveCount(4);
      await page.goto(family.manage);
      await page.getByRole("button", {name: en.draw.close, exact: true}).click();
      const confirmation = page.getByRole("dialog", {name: "Close Snowfall Christmas?", exact: true});
      await confirmation.getByRole("button", {name: "Close Snowfall Christmas", exact: true}).click();
      await expect(page).toHaveURL(new RegExp(`/en/exchanges/${family.exchangeId}$`));
      await expect(page.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      for (const locale of ["en", "es"] as const) {
        const messages = locale === "en" ? en : es;
        for (const route of ["details", "people", "draw"]) {
          await page.goto(`/${locale}/exchanges/${family.exchangeId}/manage/${route}`);
          await expect(page.getByText(messages.draw.closed, {exact: true})).toBeVisible();
          await expect(page.getByText("Winter Community Hall", {exact: true})).toBeVisible();
          await expect(page.locator('time[datetime="2026-12-24"]')).toBeVisible();
          await expect(page.locator('time[datetime="19:30"]')).toBeVisible();
          await expect(page.locator('time[datetime="2026-12-05"]')).toBeVisible();
          await expect(page.getByRole("main").locator("form,input,select,textarea")).toHaveCount(0);
          await expect(page.getByRole("button", {name: messages.draw.saveDetails, exact: true})).toHaveCount(0);
          await expect(page.locator("[data-back-row] a").first()).toHaveAttribute("href", `/${locale}/exchanges/${family.exchangeId}/manage`);
          await capture(page, info, `${locale}-closed-${drawn ? "drawn" : "undrawn"}-${route}`);
        }
      }
    } finally { await cleanup(family.familyId); }
  });
}

test("two Alex relatives remain distinct and an over-capacity pasted batch leaves no partial addition", async ({page}, info) => {
  const family = await create(page);
  const db = database();
  try {
    await page.getByRole("button", {name: "Next: who’s in"}).click();
    await add(page, "Alex, Alex");
    await expect(page.getByRole("checkbox", {name: "Alex", exact: true})).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole("checkbox", {name: "Alex", exact: true})).toHaveCount(2);
    const alex = await db.db.select({id: people.id}).from(people).where(and(eq(people.familyId, family.familyId), eq(people.displayName, "Alex")));
    expect(new Set(alex.map(({id}) => id)).size).toBe(2);
    await capture(page, info, "two-distinct-Alex-relatives");
    const more = await db.db.insert(people).values(Array.from({length: 56}, (_, i) => ({familyId: family.familyId, displayName: `Relative ${i}`}))).returning({id: people.id});
    await db.db.insert(participants).values(more.map(({id}) => ({familyId: family.familyId, exchangeId: family.exchangeId, personId: id})));
    await page.reload();
    await expect(page.getByRole("checkbox")).toHaveCount(59);
    await add(page, "Final Person One, Final Person Two");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.familyFull);
    await capture(page, info, "rejected-batch-at-59-members");
    await page.reload();
    await expect(page.getByRole("checkbox")).toHaveCount(59);
    await expect(page.getByRole("checkbox", {name: /Final Person/})).toHaveCount(0);
    const [roster] = await db.db.select({total: count()}).from(people).where(and(eq(people.familyId, family.familyId), isNull(people.removedAt)));
    const [taking] = await db.db.select({total: count()}).from(participants).where(eq(participants.exchangeId, family.exchangeId));
    expect(roster.total).toBe(59);
    expect(taking.total).toBe(59);
    await info.attach("persisted-roster-after-rejected-batch", {body: JSON.stringify({distinctAlexIds: alex, roster, participants: taking}), contentType: "application/json"});
  } finally { await db.close(); await cleanup(family.familyId); }
});

test("unfinished onboarding returns to step one, practice keeps its return path, and undrawn closure stays closed", async ({page}, info) => {
  const family = await create(page);
  try {
    await page.goto("/en/family");
    await expect(page).toHaveURL(family.manage);
    await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
    await capture(page, info, "unfinished-onboarding-step-one");
    await page.goto("/en/exchanges/practice");
    await page.getByRole("button", {name: "Start practice"}).click();
    await page.getByRole("link", {name: "Pinewisp", exact: true}).click();
    await expect(page.getByText("Viewing as Pinewisp", {exact: true})).toBeVisible();
    await expect(page.getByText(en.draw.waiting, {exact: true})).toBeVisible();
    await expect(page.getByRole("link", {name: "Stop", exact: true})).toHaveAttribute("href", "/en/exchanges/practice");
    const back = page.getByRole("link", {name: /Practice exchange/});
    await expect(back).toHaveAttribute("href", "/en/exchanges/practice");
    await capture(page, info, "practice-before-draw-has-banner-and-return");
    await back.click();
    await expect(page.getByRole("button", {name: "Draw names", exact: true})).toBeVisible();
    await page.goto(family.manage);
    await page.getByRole("button", {name: en.draw.close, exact: true}).click();
    const confirmation = page.getByRole("dialog", {name: "Close Snowfall Christmas?", exact: true});
    await confirmation.getByRole("button", {name: "Close Snowfall Christmas", exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/en/exchanges/${family.exchangeId}$`));
    await expect(page.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
    await page.goto(`${family.manage}/draw`);
    await expect(page.getByText(en.draw.closed, {exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Names are drawn"})).toHaveCount(0);
    await expect(page.getByRole("link", {name: "Next: send the keys"})).toHaveCount(0);
    await capture(page, info, "closed-undrawn-exchange-on-draw-route");
  } finally { await cleanup(family.familyId); }
});

test("nonparticipating organizer draws, members retain schedules in both languages and can ask twice", async ({page, browser, baseURL}, info) => {
  const family = await create(page);
  const db = database();
  const member = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true});
  try {
    await page.getByLabel("Gift day", {exact: true}).fill("2026-12-24");
    await page.getByLabel("Gift time at the location").fill("19:30");
    await page.getByLabel("Place").fill("Community Hall");
    await page.getByLabel("List deadline").fill("2026-12-05");
    await page.getByRole("button", {name: "Next: who’s in"}).click();
    await add(page, "Alex, Sam, Pat, Jordan");
    await expect(page.getByRole("checkbox", {name: "Jordan", exact: true})).toBeChecked();
    await page.getByRole("checkbox", {name: /Organizer/}).uncheck();
    await page.getByRole("button", {name: "Next: who lives where"}).click();
    await page.getByRole("link", {name: "Next: draw names"}).click();
    await page.getByRole("button", {name: "Draw names", exact: true}).click();
    await page.getByRole("button", {name: "Skip the animation"}).click();
    await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible();
    await expect(page.getByText(en.draw.setup.ownPerson)).toHaveCount(0);
    await capture(page, info, "draw-success-with-organizer-sitting-out");
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? en : es;
      await page.goto(`/${locale}/exchanges/${family.exchangeId}/manage`);
      await page.locator("summary").filter({hasText: messages.draw.participation}).click();
      await page.getByRole("button", {name: messages.draw.dropout.replace("{name}", "Alex"), exact: true}).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toContainText(locale === "en" ? "A few others may get a new person too."
        : "Algunas personas más también podrían recibir a alguien diferente.");
      await capture(page, info, `${locale}-dropout-explains-additional-matches-may-change`, false);
      await page.keyboard.press("Escape");
    }
    const rows = await db.db.select().from(people).where(eq(people.familyId, family.familyId));
    const alex = rows.find(({displayName}) => displayName === "Alex")!;
    await db.db.insert(items).values(rows.map(({id}) => ({familyId: family.familyId, ownerId: id, kind: "note" as const, title: "Wool mittens", position: 0})));
    const token = secret();
    const session = await runForFamily(db.db, family.familyId, (tx) => createSession(tx, family.familyId, alex.id, digest(token), "iphone", new Date()));
    await member.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: baseURL!, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: baseURL!, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    const mp = await member.newPage();
    async function facts(locale: "en" | "es") {
      const messages = locale === "en" ? en : es;
      const section = mp.getByRole("region", {name: messages.draw.detailsTitle});
      await expect(section.locator('time[datetime="2026-12-24"]')).toBeVisible();
      await expect(section.locator('time[datetime="19:30"]')).toBeVisible();
      await expect(section.locator('time[datetime="2026-12-05"]')).toBeVisible();
      await expect(section.getByText("Community Hall", {exact: true})).toBeVisible();
      await expect(section.locator("button,input,a")).toHaveCount(0);
      await expect(mp.locator('a[href*="/manage"]')).toHaveCount(0);
    }
    await mp.goto(`/en/exchanges/${family.exchangeId}`);
    await facts("en");
    await mp.getByRole("button", {name: "Or tap here to open it"}).click();
    const see = mp.getByRole("button", {name: /^See .+’s page$/});
    await expect(see).toBeVisible({timeout: 10_000});
    const recipient = (await see.innerText()).replace(/^See /, "").replace(/’s page$/, "");
    await expect(mp.getByRole("main").locator('[aria-live="assertive"]')).toContainText(recipient);
    await capture(mp, info, "reveal-announces-actual-recipient");
    await see.click();
    await facts("en");
    await mp.getByRole("region", {name: en.draw.detailsTitle}).evaluate((element) => element.scrollIntoView({block: "start"}));
    await capture(mp, info, "member-english-gift-day-time-and-deadline", false);
    await capture(mp, info, "member-after-draw-english-schedule");
    for (const question of ["Would you like blue mittens?", "Would you like green mittens?"]) {
      await mp.getByRole("button", {name: `Ask ${recipient} a question`, exact: true}).click();
      await expect(mp.getByRole("dialog")).toBeVisible();
      await mp.getByLabel("Your anonymous question").fill(question);
      await mp.getByRole("button", {name: "Send my question", exact: true}).click();
      await expect(mp.getByText(question, {exact: true})).toBeVisible();
      await expect(mp.getByRole("dialog")).toBeHidden();
    }
    await capture(mp, info, "second-anonymous-question-sent");
    await mp.goto(`/es/exchanges/${family.exchangeId}`);
    await facts("es");
    await mp.getByRole("button", {name: es.draw.reveal, exact: true}).click();
    await expect(mp.getByRole("heading", {level: 1})).toContainText(recipient);
    await facts("es");
    await mp.setViewportSize({width: 320, height: 844});
    expect(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mp.getByRole("region", {name: es.draw.detailsTitle}).evaluate((element) => element.scrollIntoView({block: "start"}));
    await capture(mp, info, "member-spanish-gift-day-time-and-deadline", false);
    await capture(mp, info, "member-after-draw-spanish-schedule-320px");
    await page.goto(family.manage);
    await page.evaluate(async () => { document.documentElement.style.zoom = "2"; await document.fonts.ready; });
    const ownPerson = page.getByRole("link", {name: "Your person", exact: true});
    const bounds = await ownPerson.boundingBox();
    const width = page.viewportSize()!.width;
    await capture(page, info, "large-text-navigation", false);
    await info.attach("large-text-navigation-bounds", {body: JSON.stringify({bounds, viewportWidth: width}), contentType: "application/json"});
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  } finally { await member.close(); await db.close(); await cleanup(family.familyId); }
});

test("revealed recipient keeps a heading and enlarged organizer navigation fits", async ({page}, info) => {
  const family = await create(page);
  try {
    await page.getByRole("button", {name: "Next: who’s in"}).click();
    await add(page, "Alex, Blake, Casey");
    await expect(page.getByRole("checkbox", {name: "Casey", exact: true})).toBeChecked();
    await page.goto(`${family.manage}/draw`);
    await page.getByRole("button", {name: "Draw names", exact: true}).click();
    await page.getByRole("button", {name: "Skip the animation"}).click();
    await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible();
    for (const locale of ["en", "es"] as const) {
      await page.setViewportSize({width: 412, height: 915});
      await page.goto(`/${locale}/exchanges/${family.exchangeId}/manage`);
      await page.evaluate(async () => { document.documentElement.style.zoom = "2"; await document.fonts.ready; });
      const row = page.locator("[data-back-row]");
      for (const link of await row.getByRole("link").all()) {
        const bounds = await link.boundingBox();
        expect(bounds).not.toBeNull();
        expect.soft(bounds!.x).toBeGreaterThanOrEqual(0);
        expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(412);
      }
      await capture(page, info, `${locale}-enlarged-organizer-navigation`, false);
    }
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.goto(`/en/exchanges/${family.exchangeId}`);
    await expect(page.getByRole("heading", {level: 1})).toBeVisible();
    await page.getByRole("button", {name: "Or tap here to open it"}).click();
    const see = page.getByRole("button", {name: /^See .+’s page$/});
    await expect(see).toBeVisible();
    const recipient = (await see.innerText()).replace(/^See /, "").replace(/’s page$/, "");
    await expect.soft(page.getByRole("heading", {level: 1})).toHaveText(`${en.draw.person.lead} ${recipient}`);
    const {violations} = await new AxeBuilder({page}).withRules(["page-has-heading-one"]).analyze();
    expect.soft(violations).toEqual([]);
    await capture(page, info, "reduced-motion-revealed-recipient-heading", false);
  } finally { await cleanup(family.familyId); }
});

test("key printing waits for credentials, prints individual cards and replaces a just-redeemed invitation", async ({page, browser, browserName}, info) => {
  const family = await create(page);
  const db = database();
  const guest = await browser.newContext({ignoreHTTPSErrors: true});
  let lock: Client | undefined;
  try {
    await page.getByRole("button", {name: "Next: who’s in"}).click();
    await add(page, "Alex, Blake, Casey");
    await expect(page.getByRole("checkbox", {name: "Casey", exact: true})).toBeChecked();
    await page.goto("/en/family/keys");
    lock = new Client({connectionString: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL});
    await lock.connect();
    await lock.query("begin");
    await lock.query("select id from families where id=$1 for update", [family.familyId]);
    await page.getByRole("button", {name: "Print cards", exact: true}).click();
    await expect(page.getByRole("button", {name: "Print 3 cards", exact: true})).toBeDisabled();
    await capture(page, info, "printing-disabled-while-real-database-is-busy");
    await lock.query("commit");
    await lock.end();
    lock = undefined;
    await expect(page.getByRole("button", {name: "Print 3 cards", exact: true})).toBeEnabled();
    await expect(page.getByRole("img", {name: en.auth.keyQr})).toHaveCount(3);
    await page.emulateMedia({media: "print"});
    await expect.soft(page.getByRole("link", {name: "Tell the family", exact: true})).toBeHidden();
    await expect.soft(page.getByRole("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await capture(page, info, "batch-print-with-QR-code-and-family-address");
    const cards = page.locator("li").filter({has: page.getByRole("img", {name: en.auth.keyQr})});
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await expect(card).toContainText(`/en/sign-in?family=${family.familyId}`);
      await expect(card.getByText(/^[A-Z0-9]{6}$/)).toBeVisible();
    }
    if (browserName === "chromium") await page.pdf({path: info.outputPath("batch-key-cards.pdf"), printBackground: true});
    await page.emulateMedia({media: "screen"});
    await page.getByRole("button", {name: "Send keys", exact: true}).click();
    const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Alex", exact: true})});
    await row.getByRole("button", {name: "Send", exact: true}).click();
    await row.getByRole("button", {name: "Print a card", exact: true}).click();
    const message = row.getByText(/^Hi Alex! This is your private key/);
    await expect(row.getByRole("img", {name: en.auth.keyQr})).toBeVisible();
    const invitation = (await message.innerText()).split(" ").at(-1)!;
    await row.getByRole("button", {name: en.auth.print, exact: true}).click();
    await expect(page.getByRole("button", {name: "Print 1 card", exact: true})).toBeEnabled();
    await page.emulateMedia({media: "print"});
    await expect.soft(page.getByRole("link", {name: "Tell the family", exact: true})).toBeHidden();
    await expect.soft(page.getByRole("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("img", {name: en.auth.keyQr})).toBeVisible();
    await expect(page.getByRole("dialog", {name: "Send keys", exact: true})
      .getByText(new RegExp(`/en/sign-in\\?family=${family.familyId}`))).toBeVisible();
    await capture(page, info, "individual-print-with-QR-code-and-family-address");
    if (browserName === "chromium") await page.pdf({path: info.outputPath("individual-key-card.pdf"), printBackground: true});
    await page.emulateMedia({media: "screen"});
    await page.getByRole("button", {name: "Send keys", exact: true}).click();
    const gp = await guest.newPage();
    await openKey(gp, invitation, "4268");
    await row.getByRole("button", {name: "Mark as sent", exact: true}).click();
    await row.getByRole("button", {name: "Reset PIN", exact: true}).click();
    await row.getByRole("button", {name: "Reset and send a new key", exact: true}).click();
    const replacement = row.getByText(/^Hi Alex! Here's your private key/);
    await expect(replacement).toBeVisible();
    expect((await replacement.innerText()).split(" ").at(-1)).not.toBe(invitation);
    await capture(page, info, "replacement-key-after-redeeming-cached-invitation");
    await page.keyboard.press("Escape");
    await db.db.update(people).set({removedAt: new Date()}).where(and(eq(people.familyId, family.familyId), eq(people.displayName, "Blake")));
    await page.getByRole("button", {name: "Print cards", exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: en.auth.feedback.unavailable})).toBeVisible();
    await expect(page.getByRole("button", {name: "Print 2 cards", exact: true})).toBeDisabled();
    await capture(page, info, "failed-print-preparation-is-visible-and-print-disabled");
  } finally {
    if (lock) { await lock.query("rollback"); await lock.end(); }
    await guest.close(); await db.close(); await cleanup(family.familyId);
  }
});
