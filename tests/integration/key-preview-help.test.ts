import {randomUUID} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {requireIssuedKey} from "../helpers/issued-key";
import {withFamily} from "../../src/server/db/client";
import {exchanges, families, outbox, people} from "../../src/server/db/schema";
import {
  inspectKey, issueKey, redeemKey, requestHelpWithKey, requestPinReset, signInWithPin, type Device,
} from "../../src/server/auth/access";
import {changeCoOrganizer, createFamily, readiness, saveMember, signInFamily} from "../../src/server/auth/families";
import {keyPreview} from "../../src/server/auth/key-preview";
import {createCodePreview} from "../../src/server/auth/code-preview";
import {authEvents, authLimits, passkeys, personalKeys, pinCredentials, pinResetRequests, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {authenticatorSecret} from "../../src/server/auth/pin";
import {askForHelpWithKey, forgotPin} from "../../src/app/[locale]/sign-in/actions";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieValues.has(name) ? {value: cookieValues.get(name)!} : undefined,
    set: (name: string, value: string) => { cookieValues.set(name, value); },
  }),
  headers: async () => new Headers({"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"}),
}));

const cookieValues = new Map<string, string>();
const cleanup = new Set<string>();
const pin = "4268";
const now = new Date();
const device = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});
const tx = withFamily;

beforeEach(() => {
  cookieValues.clear();
  vi.stubEnv("AUTH_SECRET", secret());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const familyId of cleanup) await tx(familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  cleanup.clear();
});

async function resolve(cookie: string) {
  const parsed = parseSession(cookie)!;
  return tx(parsed.familyId, (t) => findViewer(t, parsed));
}

/** The Martinez family: Christian organizes, Ana co-organizes, Rosa has an unopened key. */
async function fixture() {
  const pepper = authenticatorSecret();
  const familyId = randomUUID();
  const session = await tx(familyId, (t) => createFamily(t, {
    familyId, familyName: "Martinez", displayName: "Christian", language: "en", pin, pepper, device: device(), now,
  }));
  cleanup.add(familyId);
  const organizer = (await resolve(session.cookie))!;
  const add = async (name: string, helperId: string | null = null) => {
    await expect(tx(familyId, (t) => saveMember(t, organizer, null, {name, language: "en", helperId, householdId: null}))).resolves.toBeNull();
    const [person] = await tx(familyId, (t) => t.select().from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, name))));
    return person.id;
  };
  const rosa = await add("Rosa");
  const ana = await add("Ana");
  await expect(tx(familyId, (t) => changeCoOrganizer(t, organizer, ana))).resolves.not.toBe("forbidden");
  const issue = (personId = rosa, kind: "share" | "reset" = "share") =>
    tx(familyId, async (t) => requireIssuedKey(await issueKey(t, organizer, personId, kind, pepper, now)));
  const redeem = (value: string, typed = false, on = device()) => tx(familyId, async (t) => {
    const key = typed ? await inspectKey(t, familyId, value, now, pepper) : null;
    const preview = key ? createCodePreview(pepper, familyId, key, value, on.hash) : null;
    return redeemKey(t, {familyId, value, typed, preview, pin, confirmation: pin, pepper, device: on, currentViewer: null, now});
  });
  return {familyId, pepper, organizer, rosa, ana, add, issue, redeem};
}

/** Every row a sign-in can touch, to prove a preview changed none of them. */
async function authState(familyId: string) {
  return tx(familyId, async (t) => ({
    keys: await t.select().from(personalKeys), events: await t.select().from(authEvents),
    limits: await t.select().from(authLimits), sessions: await t.select().from(sessions),
    pins: await t.select().from(pinCredentials), requests: await t.select().from(pinResetRequests),
    passkeys: await t.select().from(passkeys), outbox: await t.select().from(outbox),
  }));
}

it("names an unopened key's owner, family and season, and nothing more", async () => {
  const f = await fixture();
  const key = await f.issue();
  await expect(tx(f.familyId, (t) => keyPreview(t, f.familyId, key.token!, now)))
    .resolves.toEqual({name: "Rosa", familyName: "Martinez", year: now.getUTCFullYear()});
  await tx(f.familyId, (t) => t.update(exchanges).set({giftDay: "2031-12-24"}).where(eq(exchanges.familyId, f.familyId)));
  await expect(tx(f.familyId, (t) => keyPreview(t, f.familyId, key.token!, now))).resolves.toMatchObject({year: 2031});
});

it("leaves the key fully usable however often the preview is fetched", async () => {
  const f = await fixture();
  const key = await f.issue();
  const before = await authState(f.familyId);
  for (let i = 0; i < 50; i++) await tx(f.familyId, (t) => keyPreview(t, f.familyId, key.token!, now));
  expect(await authState(f.familyId)).toEqual(before);
  const opened = await f.redeem(key.token!);
  expect(opened).toHaveProperty("session");
  await expect(resolve(opened.session!.cookie)).resolves.toMatchObject({personId: f.rosa});
});

it("gives revoked, used, expired, unknown and looked-after keys the generic preview", async () => {
  const f = await fixture();
  const preview = (token: string, at = now) => tx(f.familyId, (t) => keyPreview(t, f.familyId, token, at));
  const spare = await f.issue();
  const current = await f.issue();
  await expect(preview(spare.token!)).resolves.toMatchObject({name: "Rosa"});
  await expect(preview(current.token!, new Date(current.expiresAt.getTime() + 1))).resolves.toBeNull();
  // opening one key uses it up and revokes the spare
  await f.redeem(current.token!);
  await expect(preview(current.token!)).resolves.toBeNull();
  await expect(preview(spare.token!)).resolves.toBeNull();
  await expect(preview(secret())).resolves.toBeNull();
  await expect(preview("not a key")).resolves.toBeNull();
  // a person someone now looks after signs in through their helper, so their old key names no one
  const leo = await f.add("Leo");
  const leoKey = await f.issue(leo);
  await expect(preview(leoKey.token!)).resolves.toMatchObject({name: "Leo"});
  await tx(f.familyId, (t) => t.update(people).set({helperId: f.ana}).where(eq(people.id, leo)));
  await expect(preview(leoKey.token!)).resolves.toBeNull();
  // a key from another family names no one here
  const other = await fixture();
  const theirs = await other.issue();
  await expect(preview(theirs.token!)).resolves.toBeNull();
});

it("asks the organizers for help from an unopened key, and the request ends when the key is opened", async () => {
  const f = await fixture();
  const key = await f.issue();
  await expect(askForHelpWithKey(f.familyId, key.token!, false, null)).resolves.toEqual({success: "resetRequested"});
  const board = await tx(f.familyId, (t) => readiness(t, f.organizer, now));
  expect(board?.requests).toEqual([expect.objectContaining({personId: f.rosa, deviceKind: "iphone"})]);
  const notices = await tx(f.familyId, (t) => t.select().from(outbox).where(eq(outbox.template, "pin-reset-request")));
  expect(notices.map(({personId, requesterName}) => [personId, requesterName]).toSorted())
    .toEqual([[f.ana, "Rosa"], [f.organizer.personId, "Rosa"]].toSorted());
  await f.redeem(key.token!);
  expect((await tx(f.familyId, (t) => readiness(t, f.organizer, now)))?.requests).toEqual([]);
});

it("limits help requests the same way as the forgot-PIN request, across both ways in", async () => {
  const f = await fixture();
  const key = await f.issue();
  for (let i = 0; i < 3; i++) {
    await expect(askForHelpWithKey(f.familyId, key.token!, false, null)).resolves.toEqual({success: "resetRequested"});
  }
  await expect(askForHelpWithKey(f.familyId, key.token!, false, null)).resolves.toEqual({error: "tryLater"});
  await f.redeem(key.token!);
  // joined now: the PIN screen's link is the forgot-PIN request itself, still over today's limit
  await expect(forgotPin(f.familyId, f.rosa)).resolves.toEqual({error: "tryLater"});
  expect(await tx(f.familyId, (t) => t.select().from(pinResetRequests))).toHaveLength(3);
});

it("refuses help requests that a key can't vouch for", async () => {
  const f = await fixture();
  const ask = (value: string, typed: boolean, preview: string | null, on = device()) =>
    tx(f.familyId, (t) => requestHelpWithKey(t, {familyId: f.familyId, value, typed, preview, pepper: f.pepper, device: on, now}));
  // Ana opened her key, which revoked her spare
  const anaSpare = await f.issue(f.ana);
  await f.redeem((await f.issue(f.ana)).token!);
  await expect(ask(anaSpare.token!, false, null)).resolves.toEqual({error: "unavailable"});
  const key = await f.issue();
  await expect(ask(secret(), false, null)).resolves.toEqual({error: "unavailable"});
  await expect(ask("x", false, null)).resolves.toEqual({error: "unavailable"});
  // a typed code needs the signed preview from checking it on this phone
  await expect(ask(key.code!, true, null)).resolves.toEqual({error: "unavailable"});
  const phone = device();
  const entry = (await tx(f.familyId, (t) => inspectKey(t, f.familyId, key.code!, now, f.pepper)))!;
  await expect(ask(key.code!, true, createCodePreview(f.pepper, f.familyId, entry, key.code!, device().hash), phone))
    .resolves.toEqual({error: "unavailable"});
  await expect(ask(key.code!, true, createCodePreview(f.pepper, f.familyId, entry, key.code!, phone.hash), phone))
    .resolves.toEqual({success: "resetRequested", personId: f.rosa});
  await expect(tx(f.familyId, (t) => requestPinReset(t, f.familyId, randomUUID(), device(), now))).resolves.toEqual({error: "unavailable"});
});

it("lets an invited member ask by name before making a PIN, with the same notices and limit", async () => {
  const f = await fixture();
  const key = await f.issue();
  const roster = await tx(f.familyId, (t) => signInFamily(t, f.familyId));
  expect(roster?.helpNames).toContainEqual({id: f.rosa, name: "Rosa"});
  expect(roster?.names.some(({id}) => id === f.rosa)).toBe(false);
  const before = await authState(f.familyId);
  await expect(forgotPin(f.familyId, f.rosa)).resolves.toEqual({success: "resetRequested"});
  await expect(askForHelpWithKey(f.familyId, key.token!, false, null)).resolves.toEqual({success: "resetRequested"});
  await expect(forgotPin(f.familyId, f.rosa)).resolves.toEqual({success: "resetRequested"});
  await expect(forgotPin(f.familyId, f.rosa)).resolves.toEqual({error: "tryLater"});
  await expect(askForHelpWithKey(f.familyId, key.token!, false, null)).resolves.toEqual({error: "tryLater"});
  const after = await authState(f.familyId);
  for (const table of ["keys", "events", "limits", "sessions", "pins", "passkeys"] as const) {
    expect(after[table]).toEqual(before[table]);
  }
  expect(after.requests).toHaveLength(3);
  expect(after.requests.every(({personId}) => personId === f.rosa)).toBe(true);
  const notices = after.outbox.filter(({template}) => template === "pin-reset-request");
  expect(notices).toHaveLength(6);
  expect(notices.every(({requesterName}) => requesterName === "Rosa")).toBe(true);
  for (const personId of [f.ana, f.organizer.personId]) {
    expect(notices.filter((notice) => notice.personId === personId)).toHaveLength(3);
  }
  await expect(tx(f.familyId, (t) => signInWithPin(t, f.familyId, f.rosa, pin, f.pepper, device(), now)))
    .resolves.toEqual({error: "invalidPin"});
  expect((await tx(f.familyId, (t) => readiness(t, f.organizer, now)))?.requests).toHaveLength(3);
});

it("excludes removed, unknown and helper-managed members from named help", async () => {
  const f = await fixture();
  const managed = await f.add("Leo", f.ana);
  const removed = await f.add("Removed");
  await tx(f.familyId, (t) => t.update(people).set({removedAt: now}).where(eq(people.id, removed)));
  const roster = await tx(f.familyId, (t) => signInFamily(t, f.familyId));
  expect(roster?.helpNames.map(({id}) => id).toSorted()).toEqual([f.rosa, f.ana, f.organizer.personId].toSorted());
  for (const personId of [managed, removed, randomUUID()]) {
    await expect(forgotPin(f.familyId, personId)).resolves.toEqual({error: "unavailable"});
  }
  expect(await tx(f.familyId, (t) => t.select().from(pinResetRequests))).toEqual([]);
  expect(await tx(f.familyId, (t) => t.select().from(outbox).where(eq(outbox.template, "pin-reset-request")))).toEqual([]);
});
