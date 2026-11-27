import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {expect, test, type APIRequestContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import {parse} from "parse5";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {issueKey, type Device} from "../../src/server/auth/access";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {authEvents, authLimits, passkeys, personalKeys, pinCredentials, pinResetRequests, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, outbox, people} from "../../src/server/db/schema";
import {requireIssuedKey} from "../helpers/issued-key";
import {openKey, settled, typePin} from "../helpers/pin-pad";

const pin = "4268";
const phone = {width: 390, height: 844};
test.use({viewport: phone, reducedMotion: "reduce"});
const device = (value = secret()): Device => ({hash: digest(value), kind: "iphone", network: null});

async function inFamily<T>(familyId: string, action: Parameters<typeof runForFamily<T>>[2]) {
  const {db, close} = connectDatabase(process.env.DATABASE_URL!);
  try { return await runForFamily(db, familyId, action); }
  finally { await close(); }
}

async function fixture() {
  const familyId = randomUUID();
  const pepper = process.env.E2E_AUTH_SECRET!;
  const organizerDevice = secret();
  const now = new Date();
  const session = await inFamily(familyId, (t) => createFamily(t, {
    familyId, familyName: "Martinez", displayName: "Christian Martinez", language: "en", pin, pepper,
    device: device(organizerDevice), now,
  }));
  const viewer = (await inFamily(familyId, (t) => findViewer(t, parseSession(session.cookie)!)))!;
  const add = async (name: string) => inFamily(familyId, async (t) => {
    expect(await saveMember(t, viewer, null, {name, language: "en", helperId: null, householdId: null})).toBeNull();
    const [person] = await t.select().from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, name)));
    return person.id;
  });
  const key = (personId: string) => inFamily(familyId, async (t) => requireIssuedKey(await issueKey(t, viewer, personId, "share", pepper, now)));
  const path = (token: string) => `/en/key/${familyId}~${token}`;
  const cleanup = () => inFamily(familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  return {familyId, pepper, viewer, session, organizerDevice, add, key, path, cleanup};
}

async function state(familyId: string) {
  return inFamily(familyId, async (t) => ({
    keys: await t.select().from(personalKeys), events: await t.select().from(authEvents), limits: await t.select().from(authLimits),
    pins: await t.select().from(pinCredentials), sessions: await t.select().from(sessions), passkeys: await t.select().from(passkeys),
    requests: await t.select().from(pinResetRequests), notices: await t.select().from(outbox),
  }));
}

async function capture(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await settled(page);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await test.info().attach(name, {path, contentType: "image/png"});
}

async function record(name: string, value: unknown) {
  const path = test.info().outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await test.info().attach(name, {path, contentType: "application/json"});
}

/** Reads the emitted Open Graph/Twitter metadata contract returned to a chat crawler. */
async function metadata(request: APIRequestContext, path: string) {
  const response = await request.get(path, {headers: {"user-agent": "WhatsApp/2.24.21.80 A"}});
  expect(response.status()).toBe(200);
  const tags: Record<string, string> = {};
  function visit(node: ReturnType<typeof parse> | object) {
    const current = node as {tagName?: string; attrs?: Array<{name: string; value: string}>; childNodes?: object[]};
    if (current.tagName === "meta") {
      const attrs = Object.fromEntries(current.attrs!.map(({name, value}) => [name, value]));
      const name = attrs.property ?? attrs.name;
      if (name?.startsWith("og:") || name?.startsWith("twitter:")) tags[name] = attrs.content;
    }
    current.childNodes?.forEach(visit);
  }
  visit(parse(await response.text()));
  return tags;
}

test("chat previews use truthful alt text and disclose no identity for unavailable keys", async ({page, request}) => {
  const f = await fixture();
  try {
    const jose = await f.add("José");
    const long = await f.add("Rosa Ramirez");
    const wide = await f.add("W".repeat(60));
    const joseKey = await f.key(jose);
    const longKey = await f.key(long);
    const wideKey = await f.key(wide);
    const observed = [];
    const before = await state(f.familyId);
    for (const [name, key, stitched] of [["José", joseKey, null], ["Rosa Ramirez", longKey, "Rosa"], ["W".repeat(60), wideKey, null]] as const) {
      for (const locale of ["en", "es"] as const) {
        const words = locale === "en" ? en : es;
        const tags = await metadata(request, f.path(key.token!).replace("/en/", `/${locale}/`));
        expect(tags["og:title"]).toContain(name);
        const alt = stitched ? words.getIn.preview.picture.replace("{name}", stitched) : words.getIn.preview.genericPicture;
        expect(tags["og:image:alt"]).toBe(alt);
        expect(tags["twitter:image:alt"]).toBe(alt);
        observed.push({case: name, locale, tags});
      }
    }
    await page.setViewportSize({width: 1200, height: 630});
    await page.goto(`${f.path(joseKey.token!)}/preview`);
    await capture(page, "jose-generic-gift");
    await page.goto(`${f.path(longKey.token!)}/preview`);
    await capture(page, "long-name-stitched-first-name");
    expect(await state(f.familyId)).toEqual(before);
    await page.setViewportSize(phone);

    const hidden = await f.add("Marta");
    const hiddenKey = await f.key(hidden);
    const unknown = f.path(secret());
    const cases = [
      {name: "expired", change: () => inFamily(f.familyId, (t) => t.update(personalKeys).set({expiresAt: new Date(Date.now() - 1000)}).where(eq(personalKeys.id, hiddenKey.id)).execute())},
      {name: "revoked", change: () => inFamily(f.familyId, (t) => t.update(personalKeys).set({expiresAt: new Date(Date.now() + 3600000), revokedAt: new Date()}).where(eq(personalKeys.id, hiddenKey.id)).execute())},
      {name: "helper-managed", change: () => inFamily(f.familyId, (t) => t.update(people).set({helperId: f.viewer.personId}).where(eq(people.id, hidden)).execute())},
      {name: "removed", change: () => inFamily(f.familyId, (t) => t.update(people).set({helperId: null, removedAt: new Date()}).where(eq(people.id, hidden)).execute())},
    ];
    for (const {name, change} of cases) {
      await inFamily(f.familyId, async (t) => {
        await t.update(personalKeys).set({expiresAt: new Date(Date.now() + 3600000), revokedAt: null}).where(eq(personalKeys.id, hiddenKey.id));
        await t.update(people).set({helperId: null, removedAt: null}).where(eq(people.id, hidden));
      });
      await change();
      const start = await state(f.familyId);
      for (const locale of ["en", "es"] as const) {
        const words = locale === "en" ? en : es;
        const path = f.path(hiddenKey.token!).replace("/en/", `/${locale}/`);
        const tags = await metadata(request, path);
        expect(tags["og:title"]).toBe(words.home.title);
        expect(tags["og:description"]).toBe(words.getIn.preview.generic);
        expect(tags["og:image:alt"]).toBe(words.getIn.preview.genericPicture);
        expect(Object.values(tags).join(" ")).not.toMatch(/Marta|Martinez|Christian/);
        const picture = await request.get(`${path}/preview`);
        expect(picture.headers()["content-type"]).toBe("image/png");
        expect(picture.headers()["cache-control"]).toContain("no-store");
        observed.push({case: name, locale, tags});
      }
      expect(await state(f.familyId)).toEqual(start);
    }
    const unknownTags = await metadata(request, unknown);
    expect(unknownTags["og:title"]).toBe(en.home.title);
    const crossFamily = await metadata(request, `/en/key/${randomUUID()}~${joseKey.token}`);
    expect(crossFamily["og:title"]).toBe(en.home.title);
    expect(Object.values(crossFamily).join(" ")).not.toMatch(/José|Martinez|Christian/);
    await record("crawler-preview-contracts", observed);
    await page.goto(f.path(joseKey.token!));
    await page.getByRole("button", {name: "Ask Christian for help", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian"})).toHaveText("Christian has been asked. Watch your chat.");
    await capture(page, "key-welcome-help-sent");
    const helped = await state(f.familyId);
    expect(helped.keys.find(({id}) => id === joseKey.id)?.usedAt).toBeNull();
    expect(helped.requests).toEqual([expect.objectContaining({personId: jose})]);
    await openKey(page, f.path(joseKey.token!), pin);
  } finally { await f.cleanup(); }
});

test("help works on Face ID, signed-in key branches, forgot PIN and locked PIN", async ({page}) => {
  const f = await fixture();
  try {
    const rosa = await f.add("Rosa");
    const key = await f.key(rosa);
    await openKey(page, f.path(key.token!), pin);
    await page.getByRole("button", {name: "Ask Christian for help", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian"})).toHaveText("Christian has been asked. Watch your chat.");
    await capture(page, "face-id-help-sent");
    await page.goto(f.path(key.token!));
    await expect(page.getByRole("link", {name: en.auth.openAccount, exact: true})).toBeVisible();
    await page.getByRole("button", {name: "Ask Christian for help", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian"})).toHaveText("Christian has been asked. Watch your chat.");
    const marta = await f.add("Marta");
    const forwarded = await f.key(marta);
    await page.goto(f.path(forwarded.token!));
    await page.getByRole("button", {name: "Ask Christian for help", exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: "Christian"})).toHaveText("Christian has been asked. Watch your chat.");
    await capture(page, "forwarded-key-help-sent");
    expect((await state(f.familyId)).requests.map(({personId}) => personId).toSorted()).toEqual([rosa, rosa, marta].toSorted());
    await page.context().clearCookies();
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${rosa}`);
    await page.getByRole("button", {name: en.getIn.enter.forgot, exact: true}).click();
    await page.getByRole("button", {name: "Ask Christian for a new key", exact: true}).click();
    await expect(page.getByText(en.getIn.forgot.asked.replace("{organizer}", "Christian"), {exact: true})).toBeVisible();
    await page.goto(`/en/sign-in?family=${f.familyId}&person=${rosa}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      await typePin(page, "5829");
      if (attempt < 4) await expect(page.getByRole("alert").filter({hasText: en.getIn.enter.wrong})).toBeVisible();
    }
    await expect(page.getByRole("heading", {name: en.getIn.locked.title, exact: true})).toBeVisible();
    await page.getByRole("button", {name: en.getIn.locked.ask.replace("{organizer}", "Christian"), exact: true}).click();
    await expect(page.getByRole("alert").filter({hasText: en.auth.feedback.tryLater})).toBeVisible();
    await capture(page, "locked-pin-shared-help-limit");
    const after = await state(f.familyId);
    expect(after.requests.filter(({personId}) => personId === rosa)).toHaveLength(3);
    expect(after.requests.filter(({personId}) => personId === marta)).toHaveLength(1);
    await record("persisted-help-effects", {
      requests: after.requests.map(({personId, answeredAt}) => ({person: personId === rosa ? "Rosa" : "Marta", answeredAt})),
      notices: after.notices.filter(({template}) => template === "pin-reset-request").map(({requesterName, personId}) => ({requesterName, recipient: personId === f.viewer.personId ? "Christian Martinez" : personId})),
    });
  } finally { await f.cleanup(); }
});

test("a sole organizer sees recovery guidance on remembered welcome, home and Face ID", async ({page, baseURL}) => {
  const f = await fixture();
  try {
    await page.context().addCookies([
      {name: "__Host-fge-device", value: f.organizerDevice, url: baseURL!, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-family", value: f.familyId, url: baseURL!, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    for (const locale of ["en", "es"] as const) {
      const words = locale === "en" ? en : es;
      for (const path of [`/${locale}/sign-in`, `/${locale}`]) {
        await page.goto(path);
        await expect(page.getByText(words.auth.feedback.organizerRecovery, {exact: true})).toBeVisible();
        await expect(page.getByRole("button", {name: /Ask .* for help|Pedirle ayuda/})).toHaveCount(0);
      }
      await capture(page, `${locale}-sole-organizer-recovery`);
    }
    await page.context().addCookies([{name: "__Host-fge-session", value: f.session.cookie, url: baseURL!, secure: true, httpOnly: true, sameSite: "Lax"}]);
    await page.goto("/en/face-id");
    await expect(page.getByText(en.auth.feedback.organizerRecovery, {exact: true})).toBeVisible();
    expect((await state(f.familyId)).requests).toEqual([]);
  } finally { await f.cleanup(); }
});
