import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Browser, type Page} from "@playwright/test";
import {and, eq, ne} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, redeemKey, signInDevice, type Device} from "../../src/server/auth/access";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {authEvents, passkeys, pinCredentials, sessions} from "../../src/server/auth/schema";
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
    await expect(page.getByRole("status").filter({hasText: /^Face ID is off on this .+ and on devices sharing this passkey\. Your PIN hasn't changed\.$/})).toBeVisible();
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

test("phone sign-out rejects tampered targets and restores the row for retry", async ({browser}) => {
  const rosa = await context(browser, family.rosa);
  const otherFamily = await seed();
  try {
    const page = await rosa.newPage();
    const [otherMember] = await stored(family.familyId, (t) => t.select({id: sessions.id}).from(sessions)
      .where(and(eq(sessions.familyId, family.familyId), ne(sessions.personId, family.rosaId))));
    for (const target of [parseSession(family.rosa)!.id, otherMember.id, otherFamily.ipadSessionId, randomUUID(), "invalid"]) {
      await page.goto("/en/account/phones");
      // Change the action argument before it leaves the browser; the real server handles it.
      // This also avoids WebKit's duplicated requests when a routed POST body is overridden.
      await page.evaluate(({from, to}) => {
        const original = window.fetch;
        window.fetch = (input, init) => {
          if (init?.method?.toUpperCase() === "POST" && typeof init.body === "string") {
            init = {...init, body: init.body.replace(from, to)};
          }
          return original(input, init);
        };
      }, {from: family.ipadSessionId, to: target});
      const button = page.getByRole("button", {name: /^Sign out the iPad/});
      const sent = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
      await button.click();
      expect((await sent).postData()).toContain(target);
      await expect(page.getByRole("alert").filter({hasText: en.auth.feedback.unavailable})).toBeVisible();
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      const [ipad] = await stored(family.familyId, (t) => t.select({revokedAt: sessions.revokedAt}).from(sessions)
        .where(eq(sessions.id, family.ipadSessionId)));
      expect(ipad.revokedAt).toBeNull();
    }
    await shot(page, "tampered-phone-restored");
    await page.reload();
    await page.getByRole("button", {name: /^Sign out the iPad/}).click();
    await expect(page.getByRole("status").filter({hasText: "The iPad is signed out"})).toBeVisible();
    for (const [familyId, id] of [[family.familyId, otherMember.id], [otherFamily.familyId, otherFamily.ipadSessionId]]) {
      const [untouched] = await stored(familyId, (t) => t.select({revokedAt: sessions.revokedAt}).from(sessions).where(eq(sessions.id, id)));
      expect(untouched.revokedAt).toBeNull();
    }
  } finally {
    await rosa.close();
    await remove(otherFamily.familyId);
  }
});

for (const state of ["missing", "replacementRequired", "locked"] as const) {
  test(`Face ID can be turned off when the PIN is ${state}`, async ({browser}) => {
    const rosa = await context(browser, family.rosa);
    try {
      if (state === "missing") {
        await stored(family.familyId, (t) => t.update(pinCredentials).set({pinHash: null}).where(eq(pinCredentials.personId, family.rosaId)));
      } else if (state === "replacementRequired") {
        await stored(family.familyId, (t) => t.update(people).set({needsNewKey: true}).where(eq(people.id, family.rosaId)));
      } else {
        await stored(family.familyId, (t) => t.update(pinCredentials).set({lockedUntil: new Date(Date.now() + 15 * 60_000)})
          .where(eq(pinCredentials.personId, family.rosaId)));
      }
      const before = await stored(family.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, family.rosaId)));
      const page = await rosa.newPage();
      await page.goto("/en/account");
      await page.getByRole("switch", {name: t.you.faceId}).click();
      await expect(page.getByRole("status").filter({hasText: /^Face ID is off on this /})).toBeVisible();
      await page.reload();
      await expect(page.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "false");
      const credentials = await stored(family.familyId, (t) => t.select({revokedAt: passkeys.revokedAt}).from(passkeys));
      expect(credentials.every(({revokedAt}) => revokedAt !== null)).toBe(true);
      expect(await stored(family.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, family.rosaId)))).toEqual(before);
      await shot(page, `face-id-off-pin-${state}`);
    } finally {
      await rosa.close();
    }
  });
}

test("opening pages updates last use only after the fifteen-minute interval", async ({browser}) => {
  const rosa = await context(browser, family.rosa);
  try {
    const id = parseSession(family.rosa)!.id;
    const read = () => stored(family.familyId, (t) => t.select({id: sessions.id, lastUsedAt: sessions.lastUsedAt}).from(sessions));
    const page = await rosa.newPage();
    await page.goto("/en/account");
    const initial = await read();
    const at = initial.find((row) => row.id === id)!.lastUsedAt;
    expect(at).not.toBeNull();
    await page.goto("/en/account/phones");
    await page.reload();
    expect(await read()).toEqual(initial);
    const stale = new Date(Date.now() - 16 * 60_000);
    await stored(family.familyId, (t) => t.update(sessions).set({lastUsedAt: stale}).where(eq(sessions.id, id)));
    await page.reload();
    const renewed = await read();
    expect(renewed.find((row) => row.id === id)!.lastUsedAt!.getTime()).toBeGreaterThan(stale.getTime() + 15 * 60_000);
    expect(renewed.filter((row) => row.id !== id)).toEqual(initial.filter((row) => row.id !== id));
    await test.info().attach("last-use-state", {body: JSON.stringify({initial, renewed}, null, 2), contentType: "application/json"});
  } finally {
    await rosa.close();
  }
});

test("a shared passkey stops signing in on both phones while their sessions stay open", async ({browser, browserName}) => {
  test.skip(browserName !== "chromium", "WebKit has no CDP virtual-authenticator interface");
  const phoneA = await context(browser, family.rosa);
  const phoneB = await context(browser, null);
  const independent = await context(browser, family.rosaIpad);
  try {
    const a = await phoneA.newPage();
    const b = await phoneB.newPage();
    const c = await independent.newPage();
    const cdpA = await phoneA.newCDPSession(a);
    const cdpB = await phoneB.newCDPSession(b);
    const cdpC = await independent.newCDPSession(c);
    const options = {protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true} as const;
    await cdpA.send("WebAuthn.enable");
    await cdpB.send("WebAuthn.enable");
    await cdpC.send("WebAuthn.enable");
    const authA = await cdpA.send("WebAuthn.addVirtualAuthenticator", {options});
    const authB = await cdpB.send("WebAuthn.addVirtualAuthenticator", {options});
    await cdpC.send("WebAuthn.addVirtualAuthenticator", {options});
    await c.goto("/en/account");
    await expect(c.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "false");
    await c.getByRole("switch", {name: t.you.faceId}).click();
    await expect(c.getByRole("status").filter({hasText: /^Face ID is on/})).toBeVisible();
    await a.goto("/en/account");
    await a.getByRole("switch", {name: t.you.faceId}).click();
    await expect(a.getByRole("status").filter({hasText: /^Face ID is off/})).toBeVisible();
    await a.getByRole("switch", {name: t.you.faceId}).click();
    await expect(a.getByRole("status").filter({hasText: /^Face ID is on/})).toBeVisible();
    const {credentials} = await cdpA.send("WebAuthn.getCredentials", {authenticatorId: authA.authenticatorId});
    expect(credentials).toHaveLength(1);
    await cdpB.send("WebAuthn.addCredential", {authenticatorId: authB.authenticatorId, credential: credentials[0]});
    await b.goto("/en");
    await b.getByRole("button", {name: en.auth.signInFaceId}).click();
    await expect(b).toHaveURL(/\/en\/account/);
    await expect(b.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "true");
    await expect(b.getByText(/Turning it off also turns it off on devices sharing this passkey/)).toBeVisible();
    await b.getByRole("switch", {name: t.you.faceId}).click();
    await expect(b.getByRole("status").filter({hasText: /^Face ID is off/})).toBeVisible();
    await a.reload();
    await expect(a.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "false");
    await b.reload();
    await expect(b.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "false");
    await shot(b, "shared-passkey-off-sessions-open");
    await c.reload();
    await expect(c.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "true");
    await independent.clearCookies();
    await c.goto("/en");
    await c.getByRole("button", {name: en.auth.signInFaceId}).click();
    await expect(c).toHaveURL(/\/en\/account/);
    await expect(c.getByRole("switch", {name: t.you.faceId})).toHaveAttribute("aria-checked", "true");
    await shot(c, "independent-passkey-still-signs-in");
    // Restore the platform copy if the browser's credential-deletion signal removed it.
    // The server must reject it even when a different synced device still holds the private key.
    for (const [ctx, page, cdp, auth] of [[phoneA, a, cdpA, authA], [phoneB, b, cdpB, authB]] as const) {
      await cdp.send("WebAuthn.clearCredentials", {authenticatorId: auth.authenticatorId});
      await cdp.send("WebAuthn.addCredential", {authenticatorId: auth.authenticatorId, credential: credentials[0]});
      await ctx.clearCookies();
      await page.goto("/en");
      await page.getByRole("button", {name: en.auth.signInFaceId}).click();
      await expect(page.getByRole("alert").filter({hasText: en.auth.faceSignInFailed})).toBeVisible();
      await expect(page.getByRole("button", {name: en.auth.signInFaceId})).toBeEnabled();
      await shot(page, `shared-passkey-rejected-${page === a ? "a" : "b"}`);
    }
  } finally {
    await phoneA.close();
    await phoneB.close();
    await independent.close();
  }
});
