import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type APIRequestContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, redeemKey, type Device} from "../../src/server/auth/access";
import {changeCoOrganizer, createFamily, saveMember} from "../../src/server/auth/families";
import {authEvents, authLimits, personalKeys, pinCredentials, pinResetRequests, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, outbox, people} from "../../src/server/db/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {openKey, settled, typePin} from "../helpers/pin-pad";

// U1, the key link preview (1.1), and U3, "Ask Christian for help" on the getting-in screens (flows 1 and 10).

const pin = "4268";
const phone = {width: 390, height: 844};
test.use({viewport: phone, reducedMotion: "reduce"});

const device = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});
// the user agents chat apps fetch link previews with: WhatsApp, iMessage, Telegram
const chatApps = [
  "WhatsApp/2.24.21.80 A",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
  "TelegramBot (like TwitterBot)",
];

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for browser tests");
  return connectDatabase(databaseUrl);
}

async function inFamily<T>(familyId: string, action: Parameters<typeof runForFamily<T>>[2]) {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, action);
  } finally {
    await close();
  }
}

type Family = {
  familyId: string; keys: Record<string, string>; ids: Record<string, string>; organizer: string; organizerId: string;
  /** The device cookie of the phone Tito joined on, so it greets Tito on the way back. */
  titoPhone: string;
};

/** The Martinez family: Christian organizes, Ana co-organizes, Rosa and Marta have keys waiting, Beto and Tito have joined. */
async function seed(): Promise<Family> {
  const pepper = process.env.E2E_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!pepper) throw new Error("E2E_AUTH_SECRET is required");
  const familyId = randomUUID();
  const now = new Date();
  return inFamily(familyId, async (t) => {
    const organizer = await createFamily(t, {
      familyId, familyName: "Martinez", displayName: "Christian Martinez", language: "en", pin, pepper, device: device(), now,
    });
    const viewer = (await findViewer(t, parseSession(organizer.cookie)!))!;
    const ids: Record<string, string> = {};
    for (const name of ["Rosa", "Marta", "Ana", "Beto", "Tito"]) {
      await saveMember(t, viewer, null, {name, language: "en", helperId: null, householdId: null});
      const [person] = await t.select({id: people.id}).from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, name)));
      ids[name] = person.id;
    }
    await changeCoOrganizer(t, viewer, ids.Ana);
    const keys: Record<string, string> = {};
    const titoPhone = secret();
    for (const name of ["Rosa", "Marta", "Ana", "Beto", "Tito"]) {
      const key = requireIssuedKey(await issueKey(t, viewer, ids[name], "share", pepper, now));
      keys[name] = `/en/key/${familyId}~${key.token}`;
      if (name === "Ana" || name === "Beto" || name === "Tito") {
        const on = name === "Tito" ? {...device(), hash: digest(titoPhone)} : device();
        await redeemKey(t, {familyId, value: key.token, typed: false, pepper, pin, confirmation: pin, device: on, currentViewer: null, now});
      }
    }
    return {familyId, keys, ids, organizer: organizer.cookie, organizerId: viewer.personId, titoPhone};
  });
}

let family: Family;
let origin: string;

test.beforeAll(async ({baseURL}) => {
  origin = new URL(baseURL!).origin;
  family = await seed();
});

test.afterAll(async () => {
  if (family) await inFamily(family.familyId, (t) => t.delete(families).where(eq(families.id, family.familyId)).execute());
});

/** Every row that opening, claiming, using up or rate-limiting a key would touch. */
function keyState(familyId: string) {
  return inFamily(familyId, async (t) => ({
    keys: await t.select().from(personalKeys), events: await t.select().from(authEvents), limits: await t.select().from(authLimits),
    sessions: await t.select().from(sessions), pins: await t.select().from(pinCredentials),
    requests: await t.select().from(pinResetRequests), outbox: await t.select().from(outbox),
  }));
}

/** The link preview tags a chat app reads from the page's head, without running any script. */
async function previewTags(request: APIRequestContext, path: string, agent: string) {
  const response = await request.get(path, {headers: {"user-agent": agent}});
  expect(response.status()).toBe(200);
  const html = await response.text();
  const head = html.slice(0, html.indexOf("</head>"));
  const tags = Object.fromEntries([...head.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"/g)]
    .map(([, key, value]) => [key, value.replaceAll("&#x27;", "'").replaceAll("&amp;", "&")]));
  return {tags, head};
}

/** Saves the screen, checks it with axe, and that nothing runs off the phone (skipped only where the page is zoomed). */
async function shot(page: Page, name: string, fits = true) {
  await page.waitForLoadState("networkidle");
  // the screen's title streams in just after a soft navigation
  await expect(page).toHaveTitle(/\S/);
  await settled(page);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path});
  await test.info().attach(name, {path, contentType: "image/png"});
  expect((await new AxeBuilder({page}).analyze()).violations, name).toEqual([]);
  if (fits) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} fits the phone`).toBe(true);
}

test("a chat app's preview names the key's owner, and fetching it leaves the key usable", async ({page, request}) => {
  const year = new Date().getUTCFullYear();
  const before = await keyState(family.familyId);
  let image = "";
  for (const agent of chatApps) {
    const {tags, head} = await previewTags(request, family.keys.Rosa, agent);
    expect(tags).toMatchObject({
      "og:title": "Rosa's own key", "og:description": `Martinez family · Christmas ${year}`,
      "og:image:width": "1200", "og:image:height": "630", "og:image:alt": "Rosa, stitched in yarn",
      "twitter:card": "summary_large_image", "twitter:title": "Rosa's own key",
    });
    // the preview says the name, the family and the season, and nothing else about anyone
    for (const other of ["Christian", "Marta", "Ana", "Beto", "Tito"]) expect(Object.values(tags).join(" ")).not.toContain(other);
    expect(head).toContain('name="robots" content="noindex, nofollow"');
    image = tags["og:image"];
  }
  const {tags: spanish} = await previewTags(request, family.keys.Rosa.replace("/en/", "/es/"), chatApps[0]);
  expect(spanish).toMatchObject({"og:title": "La llave de Rosa", "og:description": `Familia Martinez · Navidad ${year}`});

  expect(new URL(image).pathname).toBe(`${family.keys.Rosa}/preview`);
  for (const agent of chatApps) {
    const picture = await request.get(new URL(image).pathname, {headers: {"user-agent": agent}});
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");
    expect(picture.headers()["cache-control"]).toContain("no-store");
    expect((await picture.body()).subarray(1, 4).toString()).toBe("PNG");
  }
  // not opened, claimed, used up or rate-limited: nothing about the key changed
  expect(await keyState(family.familyId)).toEqual(before);

  // and Rosa can still open it
  await openKey(page, family.keys.Rosa, pin);

  // once opened, the same link gets the generic preview
  const {tags: used} = await previewTags(request, family.keys.Rosa, chatApps[0]);
  expect(used).toMatchObject({"og:title": en.home.title, "og:description": en.getIn.preview.generic});
  expect(Object.values(used).join(" ")).not.toMatch(/Rosa|Martinez/);
  const unknown = `/en/key/${family.familyId}~${secret()}`;
  const {tags: nobody} = await previewTags(request, unknown, chatApps[0]);
  expect(nobody).toMatchObject({"og:title": en.home.title, "og:description": en.getIn.preview.generic});
  expect((await request.get(`${unknown}/preview`)).headers()["content-type"]).toBe("image/png");
});

test("the preview picture: Rosa's stitched name, and the generic gift", async ({page}) => {
  for (const [name, path] of [["f1-1_1-preview-image", `${family.keys.Marta}/preview`], ["f1-1_1-generic-image", `/en/key/${family.familyId}~${secret()}/preview`]]) {
    await page.setViewportSize({width: 1200, height: 630});
    await page.goto(path);
    const file = test.info().outputPath(`${name}.png`);
    await page.screenshot({path: file});
    await test.info().attach(name, {path: file, contentType: "image/png"});
  }
});

test("before joining: one tap from the key asks Christian, and the organizers see it", async ({page, browser}) => {
  await page.goto(family.keys.Marta);
  await expect(page.getByRole("heading", {name: en.getIn.hello.title})).toBeVisible();
  await shot(page, "f1-1_2-help");
  await page.getByRole("button", {name: en.getIn.hello.yes}).click();
  await expect(page.getByRole("heading", {name: en.getIn.pin.makeTitle})).toBeVisible();
  await shot(page, "f1-1_3-help");
  await page.getByRole("button", {name: "Ask Christian for help"}).click();
  await expect(page.getByRole("status").filter({hasText: "Christian has been asked. Watch your chat."})).toBeVisible();
  await shot(page, "f1-1_3-help-asked");
  // the key still works after asking
  await typePin(page, pin);
  await expect(page.getByRole("heading", {name: en.getIn.pin.againTitle})).toBeVisible();

  const requests = await inFamily(family.familyId, (t) => t.select().from(pinResetRequests));
  expect(requests).toEqual([expect.objectContaining({personId: family.ids.Marta, answeredAt: null})]);
  const notices = await inFamily(family.familyId, (t) => t.select().from(outbox).where(eq(outbox.template, "pin-reset-request")));
  expect(notices.map(({personId}) => personId).toSorted()).toEqual([family.ids.Ana, family.organizerId].toSorted());

  // Christian sees Marta's request in Manage my family
  const christian = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await christian.addCookies([{name: "__Host-fge-session", value: family.organizer, url: origin, secure: true, httpOnly: true, sameSite: "Lax"}]);
    const board = await christian.newPage();
    await board.goto("/en/family");
    const marta = board.getByRole("listitem").filter({has: board.getByRole("heading", {name: "Marta", exact: true})});
    await expect(marta).toContainText("Asked for a new key");
  } finally {
    await christian.close();
  }
});

test("coming back: the PIN screen asks Christian, limited like Forgot my PIN", async ({page}) => {
  await page.goto(`/en/sign-in?family=${family.familyId}&person=${family.ids.Beto}`);
  await expect(page.getByRole("heading", {name: en.getIn.enter.title})).toBeVisible();
  await shot(page, "f10-10_2-help");
  await page.getByRole("button", {name: "Ask Christian for help"}).click();
  await expect(page.getByRole("status").filter({hasText: "Christian has been asked."})).toBeVisible();
  await shot(page, "f10-10_2-help-asked");
  // two more today, then the screen says Christian was already asked
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await page.getByRole("button", {name: "Ask Christian for help"}).click();
    await expect(page.locator("p[role=status]")).toBeVisible();
  }
  await expect(page.locator("p[role=status]")).toHaveText("Christian was already asked today. Watch your chat.");
  const betos = await inFamily(family.familyId, (t) => t.select().from(pinResetRequests).where(eq(pinResetRequests.personId, family.ids.Beto)));
  expect(betos).toHaveLength(3);
});

test("welcome back, a key opened before, and a name that needs a new key all carry the link", async ({browser, page}) => {
  await page.goto(family.keys.Ana);
  await expect(page.getByRole("heading", {name: en.getIn.used.title})).toBeVisible();
  await expect(page.getByRole("button", {name: "Ask Christian for help"})).toBeVisible();
  await shot(page, "f10-10_5-help");

  const phoneContext = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await phoneContext.addCookies([
      {name: "__Host-fge-device", value: family.titoPhone, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-family", value: family.familyId, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    const back = await phoneContext.newPage();
    await back.goto("/en/sign-in");
    await expect(back.getByRole("heading", {name: /HI\s*TITO!/i})).toBeVisible();
    await back.getByRole("button", {name: "Ask Christian for help"}).click();
    await expect(back.getByRole("status").filter({hasText: "Christian has been asked."})).toBeVisible();
    await shot(back, "f10-10_1-help-asked");
  } finally {
    await phoneContext.close();
  }

  await inFamily(family.familyId, (t) => t.update(people).set({needsNewKey: true}).where(eq(people.id, family.ids.Ana)));
  try {
    await page.goto(`/en/sign-in?family=${family.familyId}&person=${family.ids.Ana}`);
    await expect(page.getByText(en.getIn.enter.newKey)).toBeVisible();
    await page.getByRole("button", {name: "Ask Christian for help"}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian has been asked."})).toBeVisible();
    await shot(page, "needs-key-help-asked");
  } finally {
    await inFamily(family.familyId, (t) => t.update(people).set({needsNewKey: false}).where(eq(people.id, family.ids.Ana)));
  }
});

test("in Spanish and at the largest text size, the link stays in the column", async ({browser}) => {
  const context = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true, locale: "es-MX"});
  try {
    const page = await context.newPage();
    const spanishKey = family.keys.Marta.replace("/en/", "/es/");
    await page.goto(spanishKey);
    await expect(page.getByRole("heading", {name: es.getIn.hello.title})).toBeVisible();
    await expect(page.getByRole("button", {name: "Pedirle ayuda a Christian"})).toBeVisible();
    await shot(page, "es-f1-1_2-help");
    await page.goto(`/es/sign-in?family=${family.familyId}&person=${family.ids.Ana}`);
    await expect(page.getByRole("button", {name: "Pedirle ayuda a Christian"})).toBeVisible();
    await shot(page, "es-f10-10_2-help");
    for (const [name, path] of [["large-f1-1_2-help", family.keys.Marta], ["large-es-f1-1_2-help", spanishKey]] as const) {
      await page.goto(path);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      const link = page.getByRole("button", {name: /Ask Christian for help|Pedirle ayuda a Christian/});
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await shot(page, name, false);
      // the stitched greeting is a fixed-size picture that zoom pushes wider than the phone (it predates this
      // link); the link itself wraps inside the column
      expect(await link.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1
        && element.getBoundingClientRect().left >= 0), `${name}: the link stays on the phone`).toBe(true);
    }
  } finally {
    await context.close();
  }
});
