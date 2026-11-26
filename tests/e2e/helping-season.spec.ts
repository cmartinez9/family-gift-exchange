import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type BrowserContextOptions, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {exchanges, families, outbox, participants, people} from "../../src/server/db/schema";
import {issueKey} from "../../src/server/auth/access";
import {pinCredentials} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {assignments, drawRuleSnapshots, practiceFamilies} from "../../src/server/draw/schema";
import {drawSeal, sealText} from "../../src/server/draw/sealing";
import {requireIssuedKey} from "../helpers/issued-key";

// The helping, notices, family-chat and end-of-season screens at 390 by 844, in English and Spanish,
// at the largest text size and with reduced motion. Screenshots land in test-results/design/<project>/.
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
async function shot(page: Page, name: string, {axe = true} = {}) {
  await page.waitForLoadState("networkidle");
  // `next dev` adds its own indicator; production builds have none.
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"
    || (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity));
  // Anything wider than the screen, or text that spills out of its own box.
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5
      || (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 && getComputedStyle(element).overflowX === "visible"))
    .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(0, 120)));
  expect(overflow, "nothing runs off the screen").toEqual([]);
  if (axe) expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  const folder = join(process.cwd(), "test-results", "design", test.info().project.name);
  mkdirSync(folder, {recursive: true});
  await page.screenshot({path: join(folder, `${name}.png`)});
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
      await helper.getByRole("button", {name: locale === "en" ? "I'm helping Marta" : "Estoy ayudando a Marta"}).click();
      await expect(helper.getByRole("heading", {name: locale === "en" ? "Helping Marta?" : "¿Ayudas a Marta?"})).toBeVisible();
      await shot(helper, `${locale === "en" ? "f9" : "f13-es"}-9_1-helping-marta`);
      await helper.getByRole("button", {name: locale === "en" ? /^Marta is here with me/ : /^Marta está aquí conmigo/}).click();
      await shot(helper, `${locale === "en" ? "f9" : "f13-es"}-9_2-hand-phone`);
      await helper.getByRole("button", {name: locale === "en" ? "Marta has the phone" : "Marta ya tiene el teléfono"}).click();
      await expect(helper.getByLabel(locale === "en" ? "4-digit PIN" : "PIN de 4 dígitos")).toBeVisible();
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
