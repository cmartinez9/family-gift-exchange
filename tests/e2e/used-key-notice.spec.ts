import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {expect, test, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import {createFamily, saveMember} from "../../src/server/auth/families";
import {issueKey, redeemKey, type Device} from "../../src/server/auth/access";
import {authEvents, personalKeys, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, outbox, people} from "../../src/server/db/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {settled, typePin} from "../helpers/pin-pad";

const pin = "4268";
const t = en.getIn;
test.use({viewport: {width: 390, height: 844}, reducedMotion: "reduce", screenshot: "only-on-failure", serviceWorkers: "block"});
const device = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});

async function fixture(joined = true) {
  const {db, close} = connectDatabase(process.env.DATABASE_URL!);
  const familyId = randomUUID();
  const pepper = process.env.E2E_AUTH_SECRET!;
  const tx = <T,>(action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(db, familyId, action);
  const organizer = await tx((tr) => createFamily(tr, {familyId, familyName: "Notice check", displayName: "Christian",
    language: "en", pin, pepper, device: device(), now: new Date()}));
  const viewer = (await tx((tr) => findViewer(tr, parseSession(organizer.cookie)!)))!;
  await tx((tr) => saveMember(tr, viewer, null, {name: "Rosa", language: "en", helperId: null, householdId: null}));
  const [member] = await tx((tr) => tr.select().from(people).where(eq(people.displayName, "Rosa")));
  const issue = async (kind: "share" | "qr" | "reset" = "share") => requireIssuedKey(
    await tx((tr) => issueKey(tr, viewer, member.id, kind, pepper, new Date())),
  );
  const key = await issue();
  const owner = joined ? await tx((tr) => redeemKey(tr, {familyId, value: key.token, typed: false, pepper,
    pin, confirmation: pin, device: device(), currentViewer: null, now: new Date()})) : null;
  const state = () => tx(async (tr) => ({
    notices: await tr.select({id: outbox.id, personId: outbox.personId, status: outbox.status, readAt: outbox.readAt,
      template: outbox.template, dedupeKey: outbox.dedupeKey}).from(outbox).where(eq(outbox.template, "key-opened-elsewhere")),
    events: await tr.select({kind: authEvents.kind, keyId: authEvents.keyId}).from(authEvents),
    sessions: await tr.select({id: sessions.id, deviceHash: sessions.deviceHash, revokedAt: sessions.revokedAt,
      resetNoticeEligible: sessions.resetNoticeEligible, trusted: sessions.trusted}).from(sessions)
      .where(eq(sessions.personId, member.id)),
  }));
  return {familyId, tx, issue, key, member, state, ownerCookie: owner?.session!.cookie ?? "", organizerCookie: organizer.cookie,
    cleanup: async () => { await tx((tr) => tr.delete(families).where(eq(families.id, familyId))); await close(); }};
}

type Family = Awaited<ReturnType<typeof fixture>>;
async function cookie(context: BrowserContext, value: string, origin: string) {
  await context.addCookies([{name: "__Host-fge-session", value, url: origin, secure: true, httpOnly: true, sameSite: "Lax"}]);
}
async function capture(page: Page, name: string) {
  await settled(page);
  await page.screenshot({path: test.info().outputPath(`${name}.png`), fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function evidence(f: Family) {
  await writeFile(test.info().outputPath("persisted-key-notices.json"), JSON.stringify(await f.state(), null, 2));
}
async function notices(f: Family, count: number) {
  try {
    await expect.poll(async () => (await f.state()).notices.length).toBe(count);
    expect((await f.state()).events.filter(({kind}) => kind === "keyOpenedElsewhere")).toHaveLength(count);
  } finally { await evidence(f); }
}
async function makePin(page: Page, value: string) {
  await typePin(page, value);
  await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
  await typePin(page, value);
}
async function code(page: Page, f: Family, value: string) {
  await page.goto(`/en/sign-in?family=${f.familyId}&join=1`);
  await page.getByLabel(en.auth.keyCode).fill(value);
  await page.getByRole("button", {name: en.auth.checkCode}).click();
}

test("every separate used-link opening reaches the owner's inbox and anonymous family activity", async ({page, browser, baseURL}) => {
  const f = await fixture();
  const owner = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}, reducedMotion: "reduce"});
  try {
    await page.goto(`/en/key/${f.familyId}~${f.key.token}`);
    await expect(page.getByText("Rosa's phone will be told.", {exact: true})).toBeVisible();
    await notices(f, 1);
    await capture(page, "used-key-confirmation");
    await typePin(page, "1111");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("4 more tries");
    await typePin(page, "1112");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("3 more tries");
    await notices(f, 1);
    await cookie(owner, f.ownerCookie, baseURL!);
    const inbox = await owner.newPage();
    await inbox.goto(`${baseURL}/en/account/notices`);
    const privateNotice = inbox.getByRole("button", {name: /Your key was opened on another device/});
    await expect(privateNotice).toHaveCount(1);
    await capture(inbox, "owner-private-inbox");
    await privateNotice.click();
    await expect.poll(async () => (await f.state()).notices.filter(({readAt}) => readAt !== null).length).toBe(1);
    await page.reload();
    await expect(page.getByText("Rosa's phone will be told.", {exact: true})).toBeVisible();
    await notices(f, 2);
    expect((await f.state()).notices.map(({status}) => status).sort()).toEqual(["captured", "skipped"]);
    await inbox.reload();
    await expect(inbox.locator('[data-notice="message"]')).toHaveCount(2);
    await inbox.goto(`${baseURL}/en/account/activity`);
    const activity = inbox.getByRole("listitem").filter({hasText: t.activity.secondPhone});
    await expect(activity).toHaveCount(2);
    for (const row of await activity.all()) {
      await expect(row).toContainText("its owner was told");
      await expect(row).not.toContainText(/Rosa|Christian/);
    }
    await capture(inbox, "anonymous-family-activity");
    // The signed-in owner's own key is not a separate-device opening.
    await inbox.goto(`${baseURL}/en/key/${f.familyId}~${f.key.token}`);
    await expect(inbox.getByRole("heading", {name: en.auth.yourKey, exact: true})).toBeVisible();
    await notices(f, 2);
    await evidence(f);
  } finally { await owner.close(); await f.cleanup(); }
});

test("forwarded used links preserve the organizer's sign-in and keep the private notice owner-only", async ({page, baseURL}) => {
  const f = await fixture();
  try {
    await cookie(page.context(), f.organizerCookie, baseURL!);
    await page.goto(`/en/key/${f.familyId}~${f.key.token}`);
    await expect(page.getByText("Signed in as Christian", {exact: true})).toBeVisible();
    await notices(f, 1);
    expect((await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value).toBe(f.organizerCookie);
    await capture(page, "forwarded-key-keeps-organizer");
    await page.goto("/en/account/notices");
    await expect(page.getByText("Your key was opened on another device", {exact: true})).toHaveCount(0);
    await page.goto("/en/account/activity");
    await expect(page.getByRole("listitem").filter({hasText: t.activity.secondPhone})).toHaveCount(1);
    await evidence(f);
  } finally { await f.cleanup(); }
});

test("a printed used code records once through a wrong PIN and successful sign-in", async ({page}) => {
  const f = await fixture();
  try {
    await code(page, f, f.key.code);
    await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
    await notices(f, 1);
    await typePin(page, "1111");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("4 more tries");
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
    await notices(f, 1);
    await capture(page, "used-code-pin-success");
    await evidence(f);
  } finally { await f.cleanup(); }
});

test("successful PIN sign-in records the opening when the initial browser POST never arrives", async ({page}) => {
  const f = await fixture();
  let dropped = 0;
  try {
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.postData()?.includes(`${f.familyId}~${f.key.token}`)) {
        dropped++; return route.abort("connectionfailed");
      }
      return route.continue();
    });
    await page.goto(`/en/key/${f.familyId}~${f.key.token}`);
    await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
    await expect.poll(() => dropped).toBe(1);
    await notices(f, 0);
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
    await notices(f, 1);
    await page.goto("/en/account/notices");
    await expect(page.getByRole("button", {name: /Your key was opened on another device/})).toHaveCount(1);
    await capture(page, "pin-recovers-missed-opening");
    await evidence(f);
  } finally { await f.cleanup(); }
});

for (const dropped of [true, false]) {
  test(`locked Face ID recovery records the same opening exactly once (opening POST dropped: ${dropped})`, async ({page, browserName, baseURL}) => {
    test.skip(browserName !== "chromium", "Virtual platform authenticator requires Chromium CDP");
    const f = await fixture();
    let openingId = "";
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal",
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
      await cookie(page.context(), f.ownerCookie, baseURL!);
      await page.goto("/en/face-id");
      await page.getByRole("button", {name: t.face.yes, exact: true}).click();
      await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
      await page.context().clearCookies({name: "__Host-fge-session"});
      await page.route("**/*", (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.postData()?.includes(`${f.familyId}~${f.key.token}`)) {
          openingId = JSON.parse(request.postData()!)[1];
          if (dropped) return route.abort("connectionfailed");
        }
        return route.continue();
      });
      await page.goto(`/en/key/${f.familyId}~${f.key.token}`);
      await expect.poll(() => openingId).toMatch(/^[0-9a-f-]{36}$/);
      await notices(f, dropped ? 0 : 1);
      for (let i = 0; i < 5; i++) {
        await typePin(page, `111${i}`);
        if (i < 4) await expect(page.getByRole("main").getByRole("alert")).toContainText(i === 3 ? "1 more try" : `${4 - i} more tries`);
      }
      await expect(page.getByRole("heading", {name: t.locked.title})).toBeVisible();
      await notices(f, dropped ? 0 : 1);
      await capture(page, "locked-with-key-context");
      await page.getByRole("button", {name: t.locked.face, exact: true}).click();
      await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
      await notices(f, 1);
      expect((await f.state()).notices[0].dedupeKey).toContain(openingId);
      await page.goto("/en/account/notices");
      await expect(page.getByRole("button", {name: /Your key was opened on another device/})).toHaveCount(1);
      await capture(page, "face-id-recovers-same-opening");
      await evidence(f);
    } finally { await f.cleanup(); }
  });
}

for (const typed of [false, true]) {
  test(`stale unused-key preview becomes a recorded used-key screen even after QR expiry (typed: ${typed})`, async ({page}) => {
    const f = await fixture(false);
    try {
      // A fresh invited member: this browser previews first, another phone redeems next.
      const qr = await f.issue("qr");
      if (typed) await code(page, f, qr.code);
      else await page.goto(`/en/key/${f.familyId}~${qr.token}`);
      await page.getByRole("button", {name: t.hello.yes}).click();
      await expect(page.getByRole("heading", {name: t.pin.makeTitle})).toBeVisible();
      await f.tx((tr) => redeemKey(tr, {familyId: f.familyId, value: qr.token, typed: false,
        pepper: process.env.E2E_AUTH_SECRET!, pin, confirmation: pin, device: device(), currentViewer: null, now: new Date()}));
      await f.tx((tr) => tr.update(personalKeys).set({expiresAt: new Date(Date.now() - 1000)})
        .where(and(eq(personalKeys.familyId, f.familyId), eq(personalKeys.id, qr.id))));
      await makePin(page, "5379");
      await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
      await notices(f, 1);
      await typePin(page, pin);
      await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
      await notices(f, 1);
      await capture(page, "stale-expired-preview-recovered");
      await evidence(f);
    } finally { await f.cleanup(); }
  });
}

test("successive resets retain older phones, deliberate sign-out clears this phone, and own PIN sign-in ends eligibility", async ({page, browser, baseURL}) => {
  const f = await fixture();
  const recovery = await browser.newContext({ignoreHTTPSErrors: true});
  try {
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${f.member.id}`);
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/en\/account$/);
    const currentId = parseSession((await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value)!.id;
    const first = await f.issue("reset");
    await page.goto(`/en/key/${f.familyId}~${first.token}`);
    await page.getByRole("button", {name: t.hello.yes}).click();
    await makePin(page, "5379");
    await expect(page.getByRole("heading", {name: t.face.title})).toBeVisible();
    await notices(f, 1);
    const before = await f.state();
    const historical = before.sessions.find(({id}) => id === currentId)!;
    expect(historical).toMatchObject({resetNoticeEligible: true, trusted: false, revokedAt: expect.any(Date)});
    await page.goto("/en/account");
    await page.getByRole("button", {name: t.you.signOut, exact: true}).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    const afterSignOut = await f.state();
    expect(afterSignOut.sessions.filter(({deviceHash}) => deviceHash === historical.deviceHash)
      .every(({resetNoticeEligible}) => !resetNoticeEligible)).toBe(true);
    const remoteId = parseSession(f.ownerCookie)!.id;
    expect(afterSignOut.sessions.find(({id}) => id === remoteId)?.resetNoticeEligible).toBe(true);
    const second = await f.issue("reset");
    await page.goto(`/en/key/${f.familyId}~${second.token}`);
    await page.getByRole("button", {name: t.hello.yes}).click();
    await makePin(page, "6842");
    await expect(page.getByRole("heading", {name: t.face.title})).toBeVisible();
    await notices(f, 2);
    const afterSecond = await f.state();
    expect(afterSecond.sessions.find(({id}) => id === remoteId)).toEqual(afterSignOut.sessions.find(({id}) => id === remoteId));
    for (const old of afterSignOut.sessions.filter(({deviceHash}) => deviceHash === historical.deviceHash)) {
      expect(afterSecond.sessions.find(({id}) => id === old.id)?.resetNoticeEligible).toBe(false);
    }
    await writeFile(test.info().outputPath("successive-resets-and-signout.json"), JSON.stringify({before, afterSignOut, afterSecond}, null, 2));
    const returned = await recovery.newPage();
    await returned.goto(`${baseURL}/en/sign-in?family=${f.familyId}&person=${f.member.id}`);
    await typePin(returned, "6842");
    await expect(returned).toHaveURL(/\/en\/account$/);
    expect((await f.state()).sessions.every(({resetNoticeEligible}) => !resetNoticeEligible)).toBe(true);
    await page.goto("/en/account/notices");
    await capture(page, "successive-reset-notices");
    await evidence(f);
  } finally { await recovery.close(); await f.cleanup(); }
});

test("unopened keys, preview-image fetches, expired unused keys, and invalid links create no opening notice", async ({page, request}) => {
  const f = await fixture(false);
  try {
    const qr = await f.issue("qr");
    const path = `/en/key/${f.familyId}~${qr.token}`;
    for (let i = 0; i < 2; i++) expect((await request.get(`${path}/preview`)).status()).toBe(200);
    await page.goto(path);
    await expect(page.getByRole("button", {name: t.hello.yes})).toBeVisible();
    await notices(f, 0);
    await page.getByRole("button", {name: t.hello.yes}).click();
    await f.tx((tr) => tr.update(personalKeys).set({expiresAt: new Date(Date.now() - 1000)})
      .where(and(eq(personalKeys.familyId, f.familyId), eq(personalKeys.id, qr.id))));
    await makePin(page, pin);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.unavailable);
    await notices(f, 0);
    expect((await f.state()).sessions).toHaveLength(0);
    await capture(page, "expired-unused-key-refused");
    await page.goto(`/en/key/${f.familyId}~${secret()}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.unavailable);
    await notices(f, 0);
  } finally { await f.cleanup(); }
});

test("two fresh phones opening the same unused link produce only one notice when the stale phone signs in", async ({page, browser, baseURL}) => {
  const f = await fixture(false);
  const firstPhone = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}, reducedMotion: "reduce"});
  try {
    const link = `${baseURL}/en/key/${f.familyId}~${f.key.token}`;
    await page.goto(link);
    await page.getByRole("button", {name: t.hello.yes}).click();
    await expect(page.getByRole("heading", {name: t.pin.makeTitle})).toBeVisible();
    const owner = await firstPhone.newPage();
    await owner.goto(link);
    await owner.getByRole("button", {name: t.hello.yes}).click();
    await makePin(owner, pin);
    await expect(owner.getByRole("heading", {name: t.face.title})).toBeVisible();
    await makePin(page, "5379");
    await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
    await notices(f, 1);
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/en\/account$/);
    await owner.goto(`${baseURL}/en/account/notices`);
    await capture(owner, "stale-opening-owner-inbox");
    await owner.goto(`${baseURL}/en/account/activity`);
    await capture(owner, "stale-opening-family-activity");
    await notices(f, 1);
  } finally { await firstPhone.close(); await f.cleanup(); }
});

for (const typed of [false, true]) {
  test(`lost reset response retries the same opening without another notice or PIN reset (typed: ${typed})`, async ({page}) => {
    const f = await fixture();
    let dropped = false;
    try {
      const reset = await f.issue("reset");
      if (typed) await code(page, f, reset.code);
      else await page.goto(`/en/key/${f.familyId}~${reset.token}`);
      await page.getByRole("button", {name: t.hello.yes}).click();
      await page.route("**/*", async (route) => {
        if (!dropped && route.request().method() === "POST" && route.request().headers()["next-action"]) {
          dropped = true;
          const originalCookies = await page.context().cookies();
          await route.fetch(); // Commit on the real server, but lose all response cookies.
          await page.context().clearCookies();
          await page.context().addCookies(originalCookies);
          return route.abort("connectionfailed");
        }
        return route.continue();
      });
      await makePin(page, "5379");
      await expect(page.getByRole("main").getByRole("alert")).toContainText(en.auth.feedback.connectionFailed);
      await notices(f, 1);
      const before = await f.state();
      expect(before.events.filter(({kind}) => kind === "resetUsed")).toHaveLength(1);
      expect(before.sessions.find(({id}) => id === parseSession(f.ownerCookie)!.id))
        .toMatchObject({resetNoticeEligible: true, trusted: false, revokedAt: expect.any(Date)});
      await makePin(page, "6842");
      await expect(page.getByRole("heading", {name: t.used.title})).toBeVisible();
      await notices(f, 1);
      expect((await f.state()).events.filter(({kind}) => kind === "resetUsed")).toHaveLength(1);
      await typePin(page, "5379");
      await expect(page).toHaveURL(/\/en\/account(?:\?.*)?$/);
      await notices(f, 1);
      expect((await f.state()).sessions.every(({resetNoticeEligible}) => !resetNoticeEligible)).toBe(true);
      await page.goto("/en/account/notices");
      await expect(page.getByRole("button", {name: /Your key was opened on another device/})).toHaveCount(1);
      await expect(page.getByText(t.notices.kind.resetUsed, {exact: true})).toBeVisible();
      await capture(page, "reset-lost-response-deduped");
      await evidence(f);
    } finally { await f.cleanup(); }
  });
}
