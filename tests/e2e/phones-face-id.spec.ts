import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, redeemKey, signInDevice, type Device} from "../../src/server/auth/access";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {authEvents, passkeys, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, people} from "../../src/server/db/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {settled, signInWithPin} from "../helpers/pin-pad";

// Your phones with a Sign out on each other phone (U2), and the Face ID switch on You (U4).
// Each screen is checked with axe and saved at 390 by 844 in Playwright's output directory.

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

type Seeded = {familyId: string; rosa: string; rosaIpad: string; rosaId: string; ipadSessionId: string};

/** Christian organizes; Rosa joined on her iPhone, with Face ID there, and is also signed in on an iPad. */
async function seed(): Promise<Seeded> {
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
    await tx((t) => saveMember(t, viewer, null, {name: "Rosa", language: "en", helperId: null, householdId: null}));
    const [person] = await tx((t) => t.select({id: people.id}).from(people)
      .where(and(eq(people.familyId, familyId), eq(people.displayName, "Rosa"))));
    const iphone = device();
    const key = requireIssuedKey(await tx((t) => issueKey(t, viewer, person.id, "share", pepper, now)));
    const joined = await tx((t) => redeemKey(t, {
      familyId, value: key.token, typed: false, pepper, pin, confirmation: pin, device: iphone, currentViewer: null, now,
    }));
    await tx((t) => t.insert(passkeys).values({
      familyId, id: secret(), personId: person.id, deviceHash: iphone.hash, publicKey: secret(), counter: "0", enrolledAt: now,
    }));
    const ipad = await tx((t) => signInDevice(t, familyId, person.id, device("ipad"), new Date(now.getTime() - 3 * 24 * 60 * 60_000)));
    return {familyId, rosa: joined.session!.cookie, rosaIpad: ipad.cookie, rosaId: person.id, ipadSessionId: ipad.id};
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

async function stored<T>(familyId: string, read: Parameters<typeof runForFamily<T>>[2]) {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, read);
  } finally {
    await close();
  }
}

async function context(browser: Browser, cookie: string | null, options: Parameters<Browser["newContext"]>[0] = {}) {
  const made = await browser.newContext({viewport: phone, reducedMotion: "reduce", ignoreHTTPSErrors: true, ...options});
  if (cookie) {
    await made.addCookies([{name: "__Host-fge-session", value: cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"}]);
  }
  return made;
}

/** Save evidence before checking accessibility and layout, so failures keep their rendered screen. */
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveTitle(/\S/);
  await settled(page);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path, fullPage, ...(fullPage ? {scale: "css" as const} : {})});
  await test.info().attach(name, {path, contentType: "image/png"});
  expect((await new AxeBuilder({page}).analyze()).violations, name).toEqual([]);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, `${name} fits the phone`).toBe(true);
}

let family: Seeded;
let origin: string;

test.beforeEach(async ({baseURL}) => {
  origin = new URL(baseURL!).origin;
  family = await seed();
});

test.afterEach(async () => {
  if (family) await remove(family.familyId);
});

test("Your phones: sign out just the iPad, and the iPhone stays in", async ({browser}) => {
  const rosa = await context(browser, family.rosa);
  const ipad = await context(browser, family.rosaIpad);
  try {
    const page = await rosa.newPage();
    await page.goto("/en/account");
    await expect(page.getByText("2 signed in")).toBeVisible();
    await page.getByRole("link", {name: /^Your phones/}).click();
    await expect(page.getByRole("heading", {name: t.phones.title})).toBeVisible();
    await expect(page.getByText(/^This (iPhone|Android device)$/)).toBeVisible();
    await expect(page.getByText(`${t.phones.now} · ${t.phones.faceOn}`)).toBeVisible();
    await expect(page.getByText(/^Last used /)).toBeVisible();
    await shot(page, "f11-11_3");

    const signOut = page.getByRole("button", {name: /^Sign out the iPad, Last used /});
    await expect(signOut).toHaveText(t.phones.signOut);
    await signOut.click();
    await expect(page.getByRole("status").filter({hasText: "The iPad is signed out"})).toBeVisible();
    await expect(page.getByRole("button", {name: /^Sign out the iPad/})).toHaveCount(0);
    await expect(page.getByText(/^This (iPhone|Android device)$/)).toBeVisible();
    await shot(page, "f11-11_3-ipad-signed-out");

    // the iPad is out; the iPhone is still in, and You counts one phone
    const lost = await ipad.newPage();
    await lost.goto("/en/account");
    await expect(lost).toHaveURL(/\/en\/sign-in/);
    await page.goto("/en/account");
    await expect(page.getByText("1 signed in")).toBeVisible();
    const [ipadSession] = await stored(family.familyId, (t) => t.select({revokedAt: sessions.revokedAt, trusted: sessions.trusted})
      .from(sessions).where(eq(sessions.id, family.ipadSessionId)));
    expect(ipadSession.revokedAt).not.toBeNull();
    expect(ipadSession.trusted).toBe(false);

    // recorded like other sign-in events: on Rosa's notices, and for the family without her name
    await page.goto("/en/account/notices");
    await expect(page.getByText("An iPad was signed out")).toBeVisible();
    await shot(page, "f11-11_2-ipad-signed-out");
    await page.goto("/en/account/activity");
    const row = page.getByRole("listitem").filter({hasText: t.activity.signedOut});
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Rosa");
    await shot(page, "f11-11_7-phone-signed-out");

    // and sign out everywhere still asks first, then signs out this one too
    await page.goto("/en/account/phones");
    await page.getByRole("button", {name: t.phones.signOutAll}).click();
    await expect(page.getByRole("dialog", {name: t.phones.sheetTitle})).toBeVisible();
    await page.getByRole("dialog").getByRole("button", {name: t.phones.signOutAll}).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  } finally {
    await rosa.close();
    await ipad.close();
  }
});

test("Face ID is a switch: off keeps the PIN, on runs the setup", async ({browser, browserName}) => {
  const rosa = await context(browser, family.rosa);
  try {
    const page = await rosa.newPage();
    const cdp = browserName === "chromium" ? await rosa.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {
        protocol: "ctap2", transport: "internal", hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      }});
    }
    await page.goto("/en/account");
    const toggle = page.getByRole("switch", {name: t.you.faceId});
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/^On for this /)).toBeVisible();
    await shot(page, "f11-11_1");

    await toggle.click();
    await expect(page.getByRole("status").filter({hasText: /^Face ID is off on this .+\. Your PIN still works\.$/})).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText(/^Off on this /)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "false");
    await shot(page, "f11-11_1-face-id-off");
    const credentials = await stored(family.familyId, (t) => t.select({revokedAt: passkeys.revokedAt}).from(passkeys));
    expect(credentials.map(({revokedAt}) => revokedAt !== null)).toEqual([true]);
    // the iPad, still signed in, was not touched
    const live = await stored(family.familyId, (t) => t.select({id: sessions.id}).from(sessions)
      .where(and(eq(sessions.personId, family.rosaId))));
    expect(live.map(({id}) => id)).toContain(family.ipadSessionId);
    await page.goto("/en/account/activity");
    await expect(page.getByRole("listitem").filter({hasText: t.activity.faceOff})).not.toContainText("Rosa");

    if (cdp) {
      await page.goto("/en/account");
      await page.getByRole("switch", {name: t.you.faceId}).click();
      await expect(page.getByRole("status").filter({hasText: /^Face ID is on for this /})).toBeVisible();
      await expect(page.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "true");
      const enrolled = await stored(family.familyId, (t) => t.select({revokedAt: passkeys.revokedAt}).from(passkeys));
      expect(enrolled.filter(({revokedAt}) => revokedAt === null)).toHaveLength(1);
      await cdp.detach();
    }

    // the PIN still gets Rosa back in on a new phone
    const fresh = await context(browser, null);
    try {
      const other = await fresh.newPage();
      await signInWithPin(other, family.familyId, "Rosa", pin);
      await expect(other).not.toHaveURL(/\/sign-in/);
    } finally {
      await fresh.close();
    }
    const offEvents = await stored(family.familyId, (t) => t.select({kind: authEvents.kind}).from(authEvents)
      .where(and(eq(authEvents.personId, family.rosaId), eq(authEvents.kind, "faceIdOff"))));
    expect(offEvents).toHaveLength(1);
  } finally {
    await rosa.close();
  }
});

test("Spanish phones and Face ID switch", async ({browser}) => {
  const spanish = await context(browser, family.rosa, {locale: "es-US"});
  try {
    const page = await spanish.newPage();
    await page.goto("/es/account");
    await expect(page.getByRole("switch", {name: es.getIn.you.faceId})).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/^Activado en este /)).toBeVisible();
    await shot(page, "es-f11-11_1");
    await page.goto("/es/account/phones");
    await expect(page.getByText(/^Este (iPhone|dispositivo Android)$/)).toBeVisible();
    await expect(page.getByText(/^Último uso: /)).toBeVisible();
    await shot(page, "es-f11-11_3");
    await page.getByRole("button", {name: /^Cerrar sesión en el iPad, Último uso/}).click();
    await expect(page.getByRole("status").filter({hasText: "Se cerró la sesión en el iPad"})).toBeVisible();
    await shot(page, "es-f11-11_3-ipad-signed-out");
    await page.goto("/es/account");
    await page.getByRole("switch", {name: es.getIn.you.faceId}).click();
    await expect(page.getByRole("status").filter({hasText: /^Face ID está desactivado en este /})).toBeVisible();
    await shot(page, "es-f11-11_1-face-id-off");
  } finally {
    await spanish.close();
  }
});

test("phones and the switch stay readable at double text size", async ({browser}) => {
  const large = await context(browser, family.rosa);
  try {
    const page = await large.newPage();
    for (const locale of ["en", "es"]) {
      for (const path of ["account/phones", "account"]) {
        await page.goto(`/${locale}/${path}`);
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await shot(page, `${locale}-large-${path.replace("/", "-")}`, true);
        const clipped = await page.locator(".fge-rows .text-row-title, .fge-rows .text-body")
          .evaluateAll((labels) => labels.filter((label) => {
            const text = document.createRange();
            text.selectNodeContents(label);
            const bounds = label.getBoundingClientRect();
            return [...text.getClientRects()].some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
          }).map((label) => label.textContent));
        expect(clipped, `${locale} ${path}: labels stay in their column`).toEqual([]);
      }
    }
  } finally {
    await large.close();
  }
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`a signed-out phone leaves the list (${reducedMotion} motion)`, async ({browser}) => {
    const moving = await context(browser, family.rosa, {reducedMotion});
    try {
      const page = await moving.newPage();
      // record what each animation asks for, so the check doesn't race the 340ms fold
      await page.addInitScript(() => {
        const animate = Element.prototype.animate;
        const seen: string[][] = [];
        Object.assign(window, {__rowMotion: seen});
        Element.prototype.animate = function (frames, options) {
          if (this.tagName === "LI" && Array.isArray(frames)) seen.push(frames.flatMap((frame) => Object.keys(frame)));
          return animate.call(this, frames, options);
        };
      });
      await page.goto("/en/account/phones");
      await page.getByRole("button", {name: /^Sign out the iPad/}).click();
      await expect(page.getByRole("status").filter({hasText: "The iPad is signed out"})).toBeVisible();
      const motion = await page.evaluate(() => (window as unknown as {__rowMotion: string[][]}).__rowMotion);
      expect(motion).toHaveLength(1);
      if (reducedMotion === "reduce") expect([...new Set(motion[0])].sort()).toEqual(["opacity"]);
      else expect(motion[0]).toEqual(expect.arrayContaining(["transform", "height"]));
    } finally {
      await moving.close();
    }
  });
}
