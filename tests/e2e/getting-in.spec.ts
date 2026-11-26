import {randomBytes, randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, redeemKey, signInDevice, type Device} from "../../src/server/auth/access";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, items, outbox, people, sizes} from "../../src/server/db/schema";
import {pinCredentials} from "../../src/server/auth/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {settled, signInWithPin, typePin} from "../helpers/pin-pad";

// Getting in, onboarding, coming back, and your account (flows 1, 2, 10 and 11 of the final design).
// Every screen is checked with axe and saved at 390 by 844 in Playwright's output directory.

const t = en.getIn;
const pin = "4268";
const phone = {width: 390, height: 844};
test.use({viewport: phone, reducedMotion: "reduce"});

const device = (kind: Device["kind"] = "iphone"): Device => ({hash: digest(secret()), kind, network: null});

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for browser tests");
  return connectDatabase(databaseUrl);
}

type Family = {
  familyId: string;
  keys: Record<string, string>;
  sessions: Record<string, string>;
  ids: Record<string, string>;
};

/**
 * A family as the design draws it: Christian organizes; Rosa, Ana and Beto have joined; Marta and Tito
 * have keys waiting. Leo is looked after by Ana.
 */
async function seed(origin: string): Promise<Family> {
  const pepper = process.env.E2E_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!pepper) throw new Error("E2E_AUTH_SECRET is required");
  const {db, close} = database();
  const familyId = randomUUID();
  const tx = <T>(action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(db, familyId, action);
  try {
    const now = new Date();
    const organizer = await tx((t) => createFamily(t, {
      familyId, familyName: "Martinez family", displayName: "Christian", language: "en", pin, pepper, device: device(), now,
    }));
    const viewer = (await tx((t) => findViewer(t, parseSession(organizer.cookie)!)))!;
    const ids: Record<string, string> = {};
    for (const name of ["Rosa", "Ana", "Beto", "Marta", "Tito"]) {
      await tx((t) => saveMember(t, viewer, null, {name, language: "en", helperId: null, householdId: null}));
      const [person] = await tx((t) => t.select({id: people.id}).from(people)
        .where(and(eq(people.familyId, familyId), eq(people.displayName, name))));
      ids[name] = person.id;
    }
    await tx((t) => saveMember(t, viewer, null, {name: "Leo", language: "en", helperId: ids.Ana, householdId: null}));
    const keys: Record<string, string> = {};
    const sessions: Record<string, string> = {christian: organizer.cookie};
    for (const name of ["Rosa", "Ana", "Beto", "Marta", "Tito"]) {
      const key = requireIssuedKey(await tx((t) => issueKey(t, viewer, ids[name], "share", pepper, now)));
      keys[name] = `${origin}/en/key/${familyId}~${key.token}`;
      if (name === "Marta" || name === "Tito") continue;
      const result = await tx((t) => redeemKey(t, {
        familyId, value: key.token, typed: false, pepper, pin, confirmation: pin, device: device(), currentViewer: null, now,
      }));
      sessions[name] = result.session!.cookie;
    }
    // Rosa's key is used again on an iPad: a notice she can question
    sessions.rosaIpad = (await tx((t) => signInDevice(t, familyId, ids.Rosa, device("ipad"), new Date()))).cookie;
    return {familyId, keys, sessions, ids};
  } finally {
    await close();
  }
}

async function remove(familyId: string) {
  const {db, close} = database();
  try {
    await runForFamily(db, familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  } finally {
    await close();
  }
}

async function signedIn(context: BrowserContext, cookie: string, origin: string) {
  await context.addCookies([{name: "__Host-fge-session", value: cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"}]);
}

/** Save evidence before checking accessibility and layout, so failures keep their rendered screen. */
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState("networkidle");
  // the screen's title streams in just after a soft navigation
  await expect(page).toHaveTitle(/\S/);
  await settled(page);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path, fullPage, ...(fullPage ? {scale: "css" as const} : {})});
  await test.info().attach(name, {path, contentType: "image/png"});
  expect((await new AxeBuilder({page}).analyze()).violations, name).toEqual([]);
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    viewportWidth: window.visualViewport?.width,
    overflowing: [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > window.innerWidth || rect.left < 0;
    }).slice(0, 20).map((element) => ({
      tag: element.tagName, text: element.textContent?.slice(0, 100),
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    })),
  }));
  if (layout.scrollWidth > layout.innerWidth) {
    await test.info().attach(`${name}-overflow`, {body: JSON.stringify(layout), contentType: "application/json"});
  }
  expect(layout.scrollWidth <= layout.innerWidth, `${name} fits the phone`).toBe(true);
}

let family: Family;
let origin: string;

test.beforeAll(async ({baseURL}) => {
  origin = new URL(baseURL!).origin;
  family = await seed(origin);
});

test.afterAll(async () => {
  if (family) await remove(family.familyId);
});

test("first visit: Marta opens her own key, makes a PIN, and is set up", async ({page}) => {
  await page.goto(family.keys.Marta);
  await expect(page.getByRole("heading", {name: t.hello.title})).toBeVisible();
  await expect(page.getByText("Christian sent you this key. It's just for you.")).toBeVisible();
  await shot(page, "f1-1_2");

  await page.getByRole("button", {name: "No, I'm helping Marta"}).click();
  await expect(page.getByRole("heading", {name: "Open it on Marta's phone"})).toBeVisible();
  await page.getByRole("button", {name: t.hello.helperBack}).click();

  await page.getByRole("button", {name: t.hello.yes}).click();
  await typePin(page, "19");
  await expect(page.getByRole("img", {name: "2 of 4 digits typed"})).toBeVisible();
  await shot(page, "f1-1_3");
  await typePin(page, "58");
  await expect(page.getByRole("alert").filter({hasText: "1958 looks like a year"})).toBeVisible();
  await shot(page, "f1-1_4");
  await typePin(page, pin);
  await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
  await typePin(page, "426");
  await shot(page, "f1-1_5");
  await typePin(page, "8");
  await expect(page.getByRole("heading", {name: t.face.title})).toBeVisible();
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await shot(page, "f1-1_6");

  await page.getByRole("link", {name: en.auth.notNow}).click();
  await expect(page.getByRole("heading", {name: t.sizes.title})).toBeVisible();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await shot(page, "f2-2_5");
  await page.getByRole("group", {name: t.sizes.tops}).getByText("M", {exact: true}).click();
  await page.getByRole("button", {name: t.sizes.bigger}).click();
  await expect(page.getByText("7½")).toBeVisible();
  await page.getByRole("switch", {name: t.sizes.noClothes}).click();
  await expect(page.getByRole("status").filter({hasText: "Got it."})).toBeVisible();
  await shot(page, "f2-2_6");
  await page.getByRole("switch", {name: t.sizes.noClothes}).click();
  await page.getByRole("button", {name: t.sizes.next}).click();

  await expect(page.getByRole("heading", {name: t.add.title})).toBeVisible();
  await shot(page, "f2-2_7");
  await page.getByRole("button", {name: t.add.paste}).click();
  await page.getByLabel(t.paste.field).fill("shop.example.com/fleece-robe");
  await expect(page.getByText("Getting the picture from Shop")).toBeVisible();
  await shot(page, "f2-2_8");
  await expect(page.getByRole("button", {name: t.add.add})).toBeEnabled({timeout: 30_000});
  await page.getByRole("button", {name: t.paste.want}).click();
  await shot(page, "f2-2_9");
  await page.getByRole("button", {name: t.hello.helperBack}).click();
  await page.getByLabel(t.add.what).fill("Gift card for coffee");
  await page.getByRole("button", {name: t.add.add}).click();

  await expect(page.getByRole("heading", {name: "ALL SET!"})).toBeVisible();
  await expect(page.getByText("1 thing on your list")).toBeVisible();
  await expect(page.getByText(t.done.sizes)).toBeVisible();
  await shot(page, "f2-2_10");
});

test("coming back: the shared iPad, a wrong PIN, forgetting it, and a rest", async ({page, browser}) => {
  await page.goto(`/en/sign-in?family=${family.familyId}`);
  await expect(page.getByRole("heading", {name: t.who.title})).toBeVisible();
  await shot(page, "f10-10_7");

  await page.getByRole("link", {name: "Rosa", exact: true}).click();
  await typePin(page, "1111");
  await expect(page.getByRole("alert").filter({hasText: "That PIN didn't match"})).toContainText("4 more tries");
  await shot(page, "f10-10_2");
  await page.getByRole("button", {name: t.enter.forgot}).click();
  await expect(page.getByRole("heading", {name: t.forgot.title})).toBeVisible();
  await page.getByRole("button", {name: "Ask Christian for a new key"}).click();
  await expect(page.getByRole("status").filter({hasText: "Christian has been asked"})).toBeVisible();
  await shot(page, "f10-10_3");
  await page.getByRole("button", {name: t.forgot.done}).click();
  await expect(page.getByRole("heading", {name: t.who.title})).toBeVisible();

  await signInWithPin(page, family.familyId, "Rosa", pin);
  await expect(page.getByRole("heading", {name: "Rosa", exact: true})).toBeVisible();
  await page.getByRole("button", {name: t.you.signOut}).click();
  await expect(page).toHaveURL(/\/en\/sign-in$/);
  // this browser has only been Rosa here: welcome back, with Face ID
  await expect(page.getByRole("heading", {name: "HI ROSA!"})).toBeVisible();
  await expect(page.getByRole("button", {name: en.auth.signInFaceId})).toBeVisible();
  await shot(page, "f10-10_1");

  const stranger = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    const guess = await stranger.newPage();
    await signInWithPin(guess, family.familyId, "Beto", "1111");
    await expect(guess.getByRole("alert").filter({hasText: "4 more tries"})).toBeVisible();
    for (const [wrong, left] of [["1112", "3 more tries"], ["1113", "2 more tries"], ["1114", "1 more try."]]) {
      await typePin(guess, wrong);
      await expect(guess.getByRole("alert").filter({hasText: left})).toBeVisible();
    }
    await typePin(guess, "1115");
    await expect(guess.getByRole("heading", {name: t.locked.title})).toBeVisible();
    await expect(guess.getByRole("img", {name: "Try again in 15 minutes"})).toBeVisible();
    await shot(guess, "f10-10_4");
  } finally {
    await stranger.close();
  }
});

test("a key opened twice, and a key forwarded to someone else's phone", async ({browser}) => {
  const second = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  const ana = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    const page = await second.newPage();
    await page.goto(family.keys.Rosa);
    await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
    await typePin(page, "4");
    await expect(page.getByText("Rosa's phone will be told.")).toBeVisible();
    await shot(page, "f10-10_5");

    await signedIn(ana, family.sessions.Ana, origin);
    const anaPage = await ana.newPage();
    await anaPage.goto(family.keys.Rosa);
    await expect(anaPage.getByRole("heading", {name: "This key is Rosa's"})).toBeVisible();
    await expect(anaPage.getByText("This phone is signed in as Ana, so it can't open Rosa's key. Nothing was changed.")).toBeVisible();
    await shot(anaPage, "f10-10_6");
  } finally {
    await second.close();
    await ana.close();
  }
});

test("you: settings, notices, phones, a key you didn't open, family activity", async ({browser}) => {
  const context = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await signedIn(context, family.sessions.Rosa, origin);
    const page = await context.newPage();
    await page.goto("/en/account");
    await expect(page.getByRole("heading", {name: "Rosa", exact: true})).toBeVisible();
    await expect(page.getByText("2 signed in")).toBeVisible();
    await shot(page, "f11-11_1");

    await page.getByRole("link", {name: /^Notices/}).click();
    await expect(page.getByRole("heading", {name: t.notices.title})).toBeVisible();
    await shot(page, "f11-11_2");
    await page.getByRole("link", {name: /An iPad signed in as you/}).click();
    await expect(page.getByRole("heading", {name: t.wasThat.title})).toBeVisible();
    await shot(page, "f11-11_5");
    await page.getByRole("button", {name: t.wasThat.notMe}).click();
    await expect(page.getByRole("status").filter({hasText: "That iPad is signed out"})).toBeVisible();
    await shot(page, "f11-11_6");

    await page.goto("/en/account/phones");
    await expect(page.getByRole("heading", {name: t.phones.title})).toBeVisible();
    await expect(page.getByText(t.phones.thisOne, {exact: true})).toBeVisible();
    await shot(page, "f11-11_3");
    await page.getByRole("button", {name: t.phones.signOutAll}).click();
    await expect(page.getByRole("dialog", {name: t.phones.sheetTitle})).toBeVisible();
    await shot(page, "f11-11_4");
    await page.getByRole("button", {name: t.phones.cancel}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/en/account/activity");
    await expect(page.getByRole("heading", {name: t.activity.title})).toBeVisible();
    await expect(page.getByText("Rosa joined")).toBeVisible();
    await shot(page, "f11-11_7");
  } finally {
    await context.close();
  }
  const out = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    const page = await out.newPage();
    await page.goto(`/en/sign-in?family=${family.familyId}&safety=1`);
    await expect(page.getByRole("heading", {name: t.paused.title})).toBeVisible();
    await shot(page, "f11-11_8");
  } finally {
    await out.close();
  }
});

test("Spanish sign-in, PIN feedback, and account screens", async ({browser}) => {
  const spanish = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true, locale: "es-US"});
  try {
    const page = await spanish.newPage();
    await page.goto(family.keys.Tito.replace("/en/", "/es/"));
    await expect(page.getByRole("heading", {name: "¿Este es tu teléfono?"})).toBeVisible();
    await shot(page, "es-f1-1_2");
    await page.getByRole("button", {name: es.getIn.hello.yes}).click();
    await expect(page.getByRole("heading", {name: es.getIn.pin.makeTitle})).toBeVisible();
    await typePin(page, "1225");
    await expect(page.getByRole("alert").filter({hasText: "1225 parece una fecha"})).toBeVisible();
    await shot(page, "es-f1-1_4");
    await signedIn(spanish, family.sessions.Beto, origin);
    await page.goto("/es/account");
    await expect(page.getByRole("heading", {name: "Beto", exact: true})).toBeVisible();
    await expect(page.getByText("Mis tallas")).toBeVisible();
    await shot(page, "es-f11-11_1");
    await page.context().clearCookies();
    await page.goto(`/es/sign-in?family=${family.familyId}&person=${family.ids.Beto}`);
    await page.getByRole("button", {name: es.getIn.enter.forgot, exact: true}).click();
    await expect(page.getByText(es.getIn.forgot.only.replace("{organizer}", "Christian"), {exact: true})).toBeVisible();
    await shot(page, "es-forgot-reset-authority");
  } finally {
    await spanish.close();
  }
});

test("account rows remain readable at double text size", async ({browser}) => {
  // the largest text size: the page zoomed so every word is twice as big, still in one column
  const large = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await signedIn(large, family.sessions.Ana, origin);
    const page = await large.newPage();
    for (const locale of ["en", "es"]) {
      await page.goto(`/${locale}/account`);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
      await shot(page, `${locale}-large-f11-11_1`, true);
      const overflowingLabels = await page.locator(".fge-rows .text-row-title, .fge-rows .text-body")
        .evaluateAll((labels) => labels.filter((label) => {
          const text = document.createRange();
          text.selectNodeContents(label);
          const bounds = label.getBoundingClientRect();
          return [...text.getClientRects()].some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
        }).map((label) => label.textContent));
      expect(overflowingLabels, `${locale}: account labels stay in their text column without covering controls`).toEqual([]);
    }
  } finally {
    await large.close();
  }
});

test("greeting animates unless reduced motion is requested", async ({browser}) => {
  // full motion: the greeting knits in; with reduced motion it is simply there
  const moving = await browser.newContext({viewport: phone, reducedMotion: "no-preference", ignoreHTTPSErrors: true});
  try {
    const page = await moving.newPage();
    await page.goto(family.keys.Tito);
    const stitches = page.locator("[data-greeting] .fge-st").first();
    await expect(stitches).toBeAttached();
    expect(await stitches.evaluate((element) => getComputedStyle(element).animationName)).not.toBe("none");
  } finally {
    await moving.close();
  }
  const still = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    const page = await still.newPage();
    await page.goto(family.keys.Tito);
    const stitches = page.locator("[data-greeting] .fge-st").first();
    expect(await stitches.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  } finally {
    await still.close();
  }
});

/** Read persisted user data after UI actions; this is evidence of saves, not a stub of the server. */
async function storedSizes(familyId: string, personId: string) {
  const {db, close} = database();
  try {
    const rows = await runForFamily(db, familyId, (tx) => tx.select({kind: sizes.kind, value: sizes.value})
      .from(sizes).where(and(eq(sizes.familyId, familyId), eq(sizes.personId, personId))));
    return Object.fromEntries(rows.map(({kind, value}) => [kind, value]));
  } finally {
    await close();
  }
}

async function storedItems(familyId: string) {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, (tx) => tx.select({ownerId: items.ownerId, kind: items.kind, title: items.title, note: items.note})
      .from(items).where(eq(items.familyId, familyId)));
  } finally {
    await close();
  }
}

async function chooseSystem(page: Page, current: string, next: string) {
  await page.getByRole("button", {name: current, exact: true}).click();
  await page.getByRole("dialog").getByText(next, {exact: true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", {name: next, exact: true})).toBeEnabled();
}

// These regressions use fresh families so recovery limits and profile changes cannot affect other flows.
test("regression: shoe systems keep ordered valid sizes and a failed choice can be retried", async ({page}) => {
  const f = await seed(origin);
  try {
    await signedIn(page.context(), f.sessions.Ana, origin);
    await page.goto("/en/welcome/sizes");
    const tops = page.getByRole("group", {name: t.sizes.tops});
    await tops.getByText("S", {exact: true}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).tops).toBe("S");
    await page.context().setOffline(true);
    await tops.getByText("M", {exact: true}).click();
    await expect(page.getByText(t.sizes.failed, {exact: true})).toBeVisible();
    await expect(tops.getByRole("radio", {name: "S", exact: true})).toBeChecked();
    await page.context().setOffline(false);
    await tops.getByText("M", {exact: true}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).tops).toBe("M");

    await chooseSystem(page, t.sizes.systemNone, "Men's US");
    for (let i = 0; i < 14; i++) await page.getByRole("button", {name: t.sizes.bigger}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).shoes).toBe("13.5");
    await expect(page.getByText("13½", {exact: true})).toBeVisible();
    await chooseSystem(page, "Men's US", "EU");
    await expect(page.getByText(t.sizes.pickOne, {exact: true})).toBeVisible();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).shoes ?? "").toBe("");
    await page.getByRole("button", {name: t.sizes.bigger}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).shoes).toBe("38");
    await chooseSystem(page, "EU", "Kids' US");
    await page.getByRole("button", {name: t.sizes.bigger}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).shoes).toBe("1C");
    await chooseSystem(page, "Kids' US", "Women's US");
    await page.getByRole("button", {name: t.sizes.bigger}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).shoes).toBe("7.5");
    await shot(page, "shoe-system-reselection");
    await page.goto("/en/account");
    await expect(page.getByRole("link", {name: /^My sizes/})).toContainText("Tops M · Shoes 7½");
    await shot(page, "account-with-saved-shoes");
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: offline words and a large camera photo remain retryable and save to the list", async ({page}) => {
  const f = await seed(origin);
  try {
    await signedIn(page.context(), f.sessions.Ana, origin);
    await page.goto("/en/welcome/list");
    await page.getByLabel(t.add.what).fill("Coffee with Grandma");
    await page.context().setOffline(true);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: t.add.failed})).toBeVisible();
    await expect(page.getByLabel(t.add.what)).toHaveValue("Coffee with Grandma");
    await shot(page, "offline-words-preserved");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("heading", {name: "ALL SET!"})).toBeVisible();
    await expect.poll(async () => (await storedItems(f.familyId)).map(({title}) => title)).toContain("Coffee with Grandma");

    await page.goto("/en/welcome/list");
    const {default: sharp} = await import("sharp");
    const buffer = await sharp(randomBytes(3000 * 3000 * 3), {raw: {width: 3000, height: 3000, channels: 3}})
      .jpeg({quality: 96}).toBuffer();
    expect(buffer.byteLength).toBeGreaterThan(6_000_000);
    await page.locator('input[type="file"]').setInputFiles({name: "camera.jpg", mimeType: "image/jpeg", buffer});
    await expect(page.getByRole("button", {name: t.add.add, exact: true})).toBeEnabled();
    const preparedBytes = await page.getByRole("img", {name: t.add.photoAlt}).evaluate(async (image) =>
      (await (await fetch((image as HTMLImageElement).src)).blob()).size);
    expect(preparedBytes).toBeLessThan(3_000_000);
    await page.getByLabel(t.add.photoTitle).fill("A cozy Christmas blanket");
    await page.context().setOffline(true);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: t.add.failed})).toBeVisible();
    await expect(page.getByLabel(t.add.photoTitle)).toHaveValue("A cozy Christmas blanket");
    await expect(page.getByRole("img", {name: t.add.photoAlt})).toBeVisible();
    await shot(page, "offline-photo-preserved");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("heading", {name: "ALL SET!"})).toBeVisible();
    await page.goto(`/en/lists/${f.ids.Ana}`);
    await expect(page.getByText("A cozy Christmas blanket", {exact: true})).toBeVisible();
    await expect.poll(() => page.locator("main img").evaluateAll((images) => images.some((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await shot(page, "camera-photo-saved");
    await test.info().attach("camera-upload-sizes", {body: JSON.stringify({originalBytes: buffer.byteLength, preparedBytes}), contentType: "application/json"});
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: link preview and save recover from offline while preserving link and note", async ({page}) => {
  const f = await seed(origin);
  try {
    await signedIn(page.context(), f.sessions.Ana, origin);
    await page.goto("/en/welcome/list");
    await page.getByRole("button", {name: t.add.paste}).click();
    await page.context().setOffline(true);
    await page.getByLabel(t.paste.field).fill("shop.example.com/scarf");
    await expect(page.getByRole("alert").filter({hasText: t.paste.failed})).toBeVisible();
    await expect(page.getByRole("status").filter({hasText: "Getting the picture"})).toHaveCount(0);
    await shot(page, "offline-preview-feedback");
    await page.context().setOffline(false);
    await page.getByLabel(t.paste.field).fill("shop.example.com/green-scarf");
    await expect(page.getByRole("button", {name: t.add.add, exact: true})).toBeEnabled({timeout: 30_000});
    await page.getByLabel(t.paste.noteField).fill("Forest green, please");
    await page.getByRole("button", {name: t.paste.want}).click();
    await page.context().setOffline(true);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: t.add.failed})).toBeVisible();
    await expect(page.getByLabel(t.paste.noteField)).toHaveValue("Forest green, please");
    await expect(page.getByLabel(t.paste.field)).toHaveValue("shop.example.com/green-scarf");
    await shot(page, "offline-link-draft-preserved");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("heading", {name: "ALL SET!"})).toBeVisible();
    await expect.poll(async () => (await storedItems(f.familyId)).map(({note}) => note)).toContain("Forest green, please");
    await test.info().attach("saved-link", {body: JSON.stringify(await storedItems(f.familyId)), contentType: "application/json"});
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: another tab switching to Help Leo rejects Ana's old draft and shows Leo's sizes", async ({page}) => {
  const f = await seed(origin);
  try {
    await signedIn(page.context(), f.sessions.Ana, origin);
    await page.goto("/en/welcome/sizes");
    await page.getByRole("group", {name: t.sizes.tops}).getByText("S", {exact: true}).click();
    await expect.poll(async () => (await storedSizes(f.familyId, f.ids.Ana)).tops).toBe("S");
    await page.goto("/en/welcome/list");
    await page.getByLabel(t.add.what).fill("Ana's private draft");
    const other = await page.context().newPage();
    await other.goto("/en/account");
    await other.getByRole("button", {name: "Help Leo", exact: true}).click();
    await expect(other.getByText("You're helping Leo", {exact: true})).toBeVisible();
    await expect(other.getByRole("link", {name: /^My sizes/})).toContainText(t.you.sizesNone);
    await other.goto("/en/welcome/sizes");
    await other.getByRole("group", {name: t.sizes.tops}).getByText("M", {exact: true}).click();
    await expect.poll(async () => {
      const {db, close} = database();
      try {
        return await runForFamily(db, f.familyId, (tx) => tx.select({value: sizes.value}).from(sizes)
          .innerJoin(people, and(eq(people.familyId, sizes.familyId), eq(people.id, sizes.personId)))
          .where(and(eq(sizes.familyId, f.familyId), eq(people.displayName, "Leo"), eq(sizes.kind, "tops"))));
      } finally { await close(); }
    }).toEqual([{value: "M"}]);
    await other.goto("/en/account");
    await expect(other.getByRole("link", {name: /^My sizes/})).toContainText("Tops M");
    await shot(other, "helper-profile-summary");
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: t.add.failed})).toBeVisible();
    await expect(page.getByLabel(t.add.what)).toHaveValue("Ana's private draft");
    expect(await storedItems(f.familyId)).toEqual([]);
    await shot(page, "stale-owner-draft-rejected");
    await other.getByRole("button", {name: t.you.stopHelping}).click();
    await expect(other.getByRole("link", {name: /^My sizes/})).toContainText("Tops S");
    await other.close();
    await page.getByRole("button", {name: t.add.add, exact: true}).click();
    await expect(page.getByRole("heading", {name: "ALL SET!"})).toBeVisible();
    expect(await storedItems(f.familyId)).toEqual([{ownerId: f.ids.Ana, kind: "note", title: "Ana's private draft", note: null}]);
  } finally {
    await remove(f.familyId);
  }
});

test("regression: Forgot suspends the pending PIN and correcting a digit submits only the corrected PIN", async ({page}) => {
  const f = await seed(origin);
  try {
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.goto(f.keys.Rosa);
    await page.waitForLoadState("networkidle");
    // Drive corrections inside the settling interval regardless of browser-driver latency.
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let submissions = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.includes("/key/")) submissions++;
    });
    await typePin(page, "4267");
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await expect(page.getByRole("dialog", {name: t.used.options})).toBeVisible();
    await page.clock.runFor(400); // Beyond the product's 260ms settling interval.
    expect(submissions).toBe(0);
    await page.getByRole("button", {name: en.ui.close, exact: true}).click();
    await page.getByRole("button", {name: t.pin.delete, exact: true}).click();
    await typePin(page, "7");
    await page.getByRole("button", {name: t.pin.delete, exact: true}).click();
    await typePin(page, "8");
    await page.clock.runFor(300);
    await page.clock.resume();
    await expect(page.getByRole("heading", {name: "Rosa", exact: true})).toBeVisible();
    expect(submissions).toBe(1);
    await shot(page, "corrected-pin-signed-in");
  } finally {
    await remove(f.familyId);
  }
});

test("account settings change language, explain installation, and sign out both phones", async ({page, browser}) => {
  const f = await seed(origin);
  const other = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await signedIn(page.context(), f.sessions.Rosa, origin);
    await signedIn(other, f.sessions.rosaIpad, origin);
    const ipad = await other.newPage();
    await ipad.goto("/en/account");
    await expect(ipad.getByRole("heading", {name: "Rosa", exact: true})).toBeVisible();
    await page.goto("/en/account");
    await page.getByRole("button", {name: t.you.homeScreen, exact: true}).click();
    await expect(page.getByRole("dialog").getByRole("heading", {name: en.notify.install.iphone, exact: true})).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", {name: en.notify.install.android, exact: true})).toBeVisible();
    await shot(page, "account-home-screen-instructions");
    await page.getByRole("button", {name: en.ui.close, exact: true}).click();
    await page.getByRole("button", {name: /^Language/}).click();
    await page.getByRole("dialog").getByRole("button", {name: en.getIn.language.es, exact: true}).click();
    await expect(page).toHaveURL(/\/es\/account$/);
    await expect(page.getByRole("link", {name: /^Mis tallas/})).toBeVisible();
    const {db, close} = database();
    try {
      const [person] = await runForFamily(db, f.familyId, (tx) => tx.select({language: people.language}).from(people)
        .where(and(eq(people.familyId, f.familyId), eq(people.id, f.ids.Rosa))));
      expect(person.language).toBe("es");
    } finally { await close(); }
    await shot(page, "account-language-changed-to-spanish");
    await page.getByRole("button", {name: new RegExp(`^${es.getIn.you.language}`)}).click();
    await page.getByRole("dialog").getByRole("button", {name: es.getIn.language.en, exact: true}).click();
    await expect(page).toHaveURL(/\/en\/account$/);
    await page.getByRole("link", {name: /^Your phones/}).click();
    await page.getByRole("button", {name: t.phones.signOutAll, exact: true}).click();
    await shot(page, "account-sign-out-both-phones-confirmation");
    await page.getByRole("dialog").getByRole("button", {name: t.phones.signOutAll, exact: true}).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await ipad.reload();
    await expect(ipad).toHaveURL(/\/en\/sign-in$/);
    await shot(page, "account-all-phones-signed-out");
  } finally {
    await other.close();
    await remove(f.familyId);
  }
});

test("regression: PIN creation and returning sign-in recover from transport failures", async ({page}) => {
  const f = await seed(origin);
  try {
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.goto(f.keys.Marta);
    await page.getByRole("button", {name: t.hello.yes}).click();
    await page.waitForLoadState("networkidle");
    // Keep the correction inside the settling interval even on a busy browser driver.
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await typePin(page, "4267");
    await page.getByRole("button", {name: t.pin.delete, exact: true}).click();
    await page.clock.runFor(400);
    await expect(page.getByRole("heading", {name: t.pin.makeTitle})).toBeVisible();
    await expect(page.getByRole("img", {name: "3 of 4 digits typed"})).toBeVisible();
    await typePin(page, "8");
    await page.clock.runFor(300);
    await page.clock.resume();
    await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
    await page.context().setOffline(true);
    await typePin(page, pin);
    await expect(page.getByRole("alert").filter({hasText: en.auth.feedback.connectionFailed})).toBeVisible();
    await expect(page.getByRole("heading", {name: t.pin.makeTitle})).toBeVisible();
    await shot(page, "offline-pin-creation-retry");
    await page.context().setOffline(false);
    await typePin(page, pin);
    await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
    await typePin(page, pin);
    await expect(page.getByRole("heading", {name: t.face.title})).toBeVisible();
    await page.goto("/en/account");
    await page.getByRole("button", {name: t.you.signOut, exact: true}).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${f.ids.Rosa}`);
    await expect(page.getByRole("heading", {name: t.enter.title})).toBeVisible();
    await page.context().setOffline(true);
    await typePin(page, pin);
    await expect(page.getByRole("alert").filter({hasText: en.auth.feedback.connectionFailed})).toBeVisible();
    await shot(page, "offline-enter-pin-retry");
    await page.context().setOffline(false);
    await typePin(page, pin);
    await expect(page.getByRole("heading", {name: "Rosa", exact: true})).toBeVisible();
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: used-key recovery keeps errors visible and reporting does not block replacement requests", async ({page}) => {
  const f = await seed(origin);
  try {
    await page.goto(f.keys.Rosa);
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await page.context().setOffline(true);
    const ask = page.getByRole("button", {name: "Ask Christian for a new key", exact: true});
    await ask.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
    await expect(ask).toBeEnabled();
    await page.getByRole("button", {name: t.used.never, exact: true}).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
    await shot(page, "offline-used-key-recovery");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: t.used.never, exact: true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await expect(ask).toBeEnabled();
    await ask.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Repeat through the public UI up to the real daily server limit.
    for (let i = 0; i < 2; i++) {
      await page.reload();
      await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
      await ask.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page.reload();
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await ask.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(en.auth.feedback.tryLater);
    await expect(ask).toBeEnabled();
    await shot(page, "daily-recovery-limit-visible");
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: Forgot and printed-code preview explain offline failures and allow a retry", async ({page}) => {
  const f = await seed(origin);
  try {
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${f.ids.Beto}`);
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await page.context().setOffline(true);
    await page.getByRole("button", {name: "Ask Christian for a new key", exact: true}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
    await page.context().setOffline(false);
    await page.getByRole("button", {name: "Ask Christian for a new key", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian has been asked"})).toBeVisible();
    await page.goto(`/en/sign-in?family=${f.familyId}&join=1`);
    await page.getByLabel(en.auth.keyCode).fill("ABC234");
    await page.context().setOffline(true);
    await page.getByRole("button", {name: en.auth.checkCode}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
    await expect(page.getByRole("button", {name: en.auth.checkCode})).toBeEnabled();
    await shot(page, "offline-code-preview-retry");
    await page.context().setOffline(false);
    await page.getByRole("button", {name: en.auth.checkCode}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.unavailable);
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: a locked PIN counts down and can be retried after the server lock expires", async ({page}) => {
  const f = await seed(origin);
  try {
    await signInWithPin(page, f.familyId, "Beto", "1111");
    await expect(page.getByRole("alert").filter({hasText: "4 more tries"})).toBeVisible();
    for (const [wrong, left] of [["1112", "3 more tries"], ["1113", "2 more tries"], ["1114", "1 more try."]]) {
      await typePin(page, wrong);
      await expect(page.getByRole("alert").filter({hasText: left})).toBeVisible();
    }
    await typePin(page, "1115");
    await expect(page.getByRole("heading", {name: t.locked.title})).toBeVisible();
    await page.context().setOffline(true);
    await page.getByRole("button", {name: "Ask Christian for a new PIN", exact: true}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
    await page.context().setOffline(false);
    await page.clock.install();
    await page.clock.fastForward(60_000);
    await expect(page.getByRole("img", {name: "Try again in 14 minutes"})).toBeVisible();
    // Advance the client timer and expire only this fixture's real persisted server lock.
    const {db, close} = database();
    try {
      await runForFamily(db, f.familyId, (tx) => tx.update(pinCredentials).set({lockedUntil: new Date(Date.now() - 1)})
        .where(and(eq(pinCredentials.familyId, f.familyId), eq(pinCredentials.personId, f.ids.Beto))));
    } finally { await close(); }
    await page.clock.fastForward(14 * 60_000);
    await expect(page.getByText(t.locked.ready, {exact: true})).toBeVisible();
    await page.screenshot({path: test.info().outputPath("expired-lock-retry.png")});
    await page.getByRole("button", {name: t.locked.retry, exact: true}).click();
    await typePin(page, pin);
    await expect(page.getByRole("heading", {name: "Beto", exact: true})).toBeVisible();
  } finally {
    await page.context().setOffline(false);
    await remove(f.familyId);
  }
});

test("regression: opening a reset notice clears its unread indicator and family activity explains its audience", async ({page}) => {
  const f = await seed(origin);
  try {
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${f.ids.Ana}`);
    await page.getByRole("button", {name: t.enter.forgot, exact: true}).click();
    await page.getByRole("button", {name: "Ask Christian for a new key", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian has been asked"})).toBeVisible();
    await signedIn(page.context(), f.sessions.christian, origin);
    await page.goto("/en/account");
    await expect(page.getByRole("link", {name: /^Notices/})).toContainText("1 new");
    await page.getByRole("link", {name: /^Notices/}).click();
    await page.getByRole("button", {name: /View PIN reset requests/}).click();
    await expect(page).toHaveURL(/\/en\/family$/);
    await page.goto("/en/account");
    await expect(page.getByRole("link", {name: /^Notices/})).not.toContainText("1 new");
    const {db, close} = database();
    try {
      const rows = await runForFamily(db, f.familyId, (tx) => tx.select({readAt: outbox.readAt}).from(outbox).where(eq(outbox.familyId, f.familyId)));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(({readAt}) => readAt !== null)).toBe(true);
      await test.info().attach("persisted-notice-read", {body: JSON.stringify(rows), contentType: "application/json"});
    } finally { await close(); }
    await shot(page, "reset-notice-read");
    await page.goto("/en/account/activity");
    await expect(page.getByText(t.activity.lead, {exact: true})).toBeVisible();
    await page.goto("/es/account/activity");
    await expect(page.getByText(es.getIn.activity.lead, {exact: true})).toBeVisible();
    await shot(page, "spanish-family-activity-audience");
  } finally {
    await remove(f.familyId);
  }
});

test("regression: an installed passkey stays shown as on after cookies are cleared", async ({page, browserName}) => {
  test.skip(browserName !== "chromium", "Virtual platform authenticator uses Chromium CDP");
  const f = await seed(origin);
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    }});
    await signedIn(page.context(), f.sessions.Ana, origin);
    await page.goto("/en/face-id");
    await page.getByRole("button", {name: t.face.yes, exact: true}).click();
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/en");
    await page.getByRole("button", {name: en.auth.signInFaceId, exact: true}).click();
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    await expect(page.getByRole("listitem").filter({has: page.getByText(t.you.faceId, {exact: true})})).toContainText("On for this");
    await expect(page.getByRole("link", {name: t.you.newPinGo, exact: true})).toBeVisible();
    await shot(page, "passkey-after-clearing-cookies");
    await page.getByRole("link", {name: /^Your phones/}).click();
    await expect(page.getByRole("listitem").filter({has: page.getByText(t.phones.thisOne, {exact: true})})).toContainText(t.phones.faceOn);
    await shot(page, "current-phone-passkey-status");
    await page.goBack();
    await page.getByRole("link", {name: t.you.newPinGo, exact: true}).click();
    await typePin(page, "5937");
    await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
    await typePin(page, "5937");
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    await page.getByRole("button", {name: t.you.signOut, exact: true}).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await signInWithPin(page, f.familyId, "Ana", "5937");
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    await shot(page, "changed-account-pin-signed-in");
  } finally {
    await remove(f.familyId);
  }
});
