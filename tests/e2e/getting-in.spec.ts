import {mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, redeemKey, signInDevice, type Device} from "../../src/server/auth/access";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, people} from "../../src/server/db/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {settled, signInWithPin, typePin} from "../helpers/pin-pad";

// Getting in, onboarding, coming back, and your account (flows 1, 2, 10 and 11 of the final design).
// Every screen is checked with axe and saved at 390 by 844 under test-results/design/.

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

/** Saves the screen as the design names it, after axe finds nothing. */
async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  // the screen's title streams in just after a soft navigation
  await expect(page).toHaveTitle(/\S/);
  await settled(page);
  expect((await new AxeBuilder({page}).analyze()).violations, name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} fits the phone`).toBe(true);
  const directory = join("test-results", "design", test.info().project.name);
  mkdirSync(directory, {recursive: true});
  await page.screenshot({path: join(directory, `${name}.png`)});
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

test("in Spanish, at the largest text size, and with full motion", async ({browser}) => {
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
  } finally {
    await spanish.close();
  }

  // the largest text size: the page zoomed so every word is twice as big, still in one column
  const large = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true});
  try {
    await signedIn(large, family.sessions.Ana, origin);
    const page = await large.newPage();
    await page.goto("/en/account");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(page.getByRole("heading", {name: "Ana", exact: true})).toBeVisible();
    await shot(page, "large-f11-11_1");
  } finally {
    await large.close();
  }

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
