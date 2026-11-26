import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {and, eq, sql} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {withFamily} from "../../src/server/db/client";
import {families, households, people} from "../../src/server/db/schema";
import {
  allowCodeTry, disputeUsedKey, inspectKey, issueKey, markKeySent, redeemKey, requestPinReset, signInWithPin, type Device
} from "../../src/server/auth/access";
import {createFamily, saveMember, readiness, signInFamily, changeCoOrganizer, saveHousehold, changeKeepApart, removeMember} from "../../src/server/auth/families";
import {authEvents, authLimits, passkeys, personalKeys, pinCredentials, pinResetRequests, sessionDisputes, sessions} from "../../src/server/auth/schema";
import {findViewer, parseSession, digest, secret} from "../../src/server/auth/session";
import {account, actFor, disputeEvent, endSessions, listKeyDisputes, listSessionDisputes} from "../../src/server/auth/security";
import {day, fifteenMinutes} from "../../src/server/auth/pin";

vi.mock("server-only", () => ({}));

const pepper = secret();
const pin = "4268";
const newPin = "6285";
const now = new Date();
const makeDevice = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});
const cleanup = new Set<string>();
const tx = withFamily;

async function resolve(cookie: string) {
  const parsed = parseSession(cookie)!;
  return tx(parsed.familyId, (t) => findViewer(t, parsed));
}

async function fixture() {
  const familyId = randomUUID();
  const organizer = await tx(familyId, (t) => createFamily(t, {
    familyId, familyName: "Frostfall", displayName: "Northstar", language: "en", pin, pepper,
    device: makeDevice(), now,
  }));
  cleanup.add(familyId);
  const viewer = (await resolve(organizer.cookie))!;
  const add = async (name = "Snowbit", helperId: string | null = null) => {
    await expect(tx(familyId, (t) => saveMember(t, viewer, null, {name, language: "es", helperId, householdId: null}))).resolves.toBeNull();
    const [person] = await tx(familyId, (t) => t.select().from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, name))));
    return person.id;
  };
  const personId = await add();
  const issue = (kind: "share" | "qr" | "print" | "reset" = "share", at = now) =>
    tx(familyId, (t) => issueKey(t, viewer, personId, kind, pepper, at));
  const redeem = (value: string, device: Device, typed = false, at = now, chosenPin = pin) =>
    tx(familyId, (t) => redeemKey(t, {familyId, value, typed, pin: chosenPin, confirmation: chosenPin, pepper, device, currentViewer: null, now: at}));
  const login = (attempted: string, device: Device, at = now) =>
    tx(familyId, (t) => signInWithPin(t, familyId, personId, attempted, pepper, device, at));

  return {familyId, organizer, viewer, personId, add, issue, redeem, login};
}

afterEach(async () => {
  for (const familyId of cleanup) {
    await tx(familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  }
  cleanup.clear();
});

it("requires a personal key, stores hashes, and redeems a link or its code only once across concurrent attempts", async () => {
  const f = await fixture();
  const device = makeDevice();
  await expect(f.login(pin, device)).resolves.toEqual({error: "invalidPin"});
  await expect(f.redeem(secret(), device)).resolves.toEqual({error: "unavailable"});
  expect((await tx(f.familyId, (t) => signInFamily(t, f.familyId)))?.names).toHaveLength(1);
  const issued = await f.issue();
  const wrongPhone = await tx(f.familyId, (t) => redeemKey(t, {
    familyId: f.familyId, value: issued.token!, typed: false, pin, confirmation: pin,
    pepper, device, currentViewer: f.viewer, now,
  }));
  expect(wrongPhone).toEqual({error: "otherPerson"});
  const stored = await tx(f.familyId, async (t) => (await t.select().from(personalKeys))[0]);
  expect(stored.tokenHash).toBe(digest(issued.token!));
  expect(stored.codeHash).not.toBe(issued.code);
  const results = await Promise.all([f.redeem(issued.token!, device), f.redeem(issued.code!, makeDevice(), true)]);
  expect(results.filter(({session}) => session)).toHaveLength(1);
  expect(results.find(({error}) => error)).toEqual({error: "usedKey"});
  const usedKey = await tx(f.familyId, (t) => inspectKey(t, f.familyId, issued.token!, now));
  expect(usedKey).toMatchObject({available: false, usedAt: now, usedDevice: "iphone"});
  const signedIn = (await resolve(results.find(({session}) => session)!.session!.cookie))!;
  const view = await tx(f.familyId, (t) => account(t, signedIn));
  expect(view.activity.map(({kind}) => kind)).toEqual(expect.arrayContaining(["keyUsed", "newDevice"]));
  expect((await tx(f.familyId, (t) => signInFamily(t, f.familyId)))?.names).toHaveLength(2);
});

it("expires a displayed QR and throttles typed-code guesses independently of device cookies", async () => {
  const f = await fixture();
  const qr = await f.issue("qr");
  const later = new Date(now.getTime() + 11 * 60_000);
  await expect(f.redeem(qr.token!, makeDevice(), false, later)).resolves.toEqual({error: "unavailable"});
  const network = digest(secret());
  for (let i = 0; i < 12; i++) {
    expect(await tx(f.familyId, (t) => allowCodeTry(t, f.familyId, {...makeDevice(), network}, now))).toBe(true);
  }
  expect(await tx(f.familyId, (t) => allowCodeTry(t, f.familyId, {...makeDevice(), network}, now))).toBe(false);
});

it("enforces both persistent lockouts and shows them to the member", async () => {
  const f = await fixture();
  const trusted = makeDevice();
  const other = makeDevice();
  const joined = await f.redeem((await f.issue()).token!, trusted);
  for (let i = 0; i < 4; i++) await expect(f.login("6544", other)).resolves.toEqual({error: "invalidPin"});
  await expect(f.login("6544", other)).resolves.toEqual({error: "pinLocked"});
  await expect(f.login(pin, trusted)).resolves.toEqual({error: "pinLocked"});
  const later = new Date(now.getTime() + fifteenMinutes);
  for (let i = 0; i < 4; i++) await expect(f.login("6544", other, later)).resolves.toEqual({error: "invalidPin"});
  await expect(f.login("6544", other, later)).resolves.toEqual({error: "newDevicesLocked"});
  const tomorrow = new Date(now.getTime() + day);
  await expect(f.login(pin, other, tomorrow)).resolves.toEqual({error: "newDevicesLocked"});
  const member = (await resolve(joined.session!.cookie))!;
  const {activity} = await tx(f.familyId, (t) => account(t, member));
  expect(activity.map(({kind}) => kind)).toEqual(expect.arrayContaining(["pinLocked", "newDevicesLocked"]));
  await expect(f.login(pin, trusted, tomorrow)).resolves.toHaveProperty("session");
  await expect(resolve(joined.session!.cookie)).resolves.toBeNull();
  await expect(f.login(pin, other, tomorrow)).resolves.toHaveProperty("session");
});

it("notifies other sessions of a new device, allows disputes, and signs out everywhere", async () => {
  const f = await fixture();
  const first = (await f.redeem((await f.issue()).token!, makeDevice())).session!;
  const second = (await f.login(pin, makeDevice())).session!;
  const firstViewer = (await resolve(first.cookie))!;
  const parsed = parseSession(first.cookie)!;
  await expect(resolve(`${parsed.familyId}.${parsed.id}.${secret()}`)).resolves.toBeNull();
  const {activity} = await tx(f.familyId, (t) => account(t, firstViewer));
  const suspicious = activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === second.id)!;
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, suspicious.id, now))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => disputeEvent(t, firstViewer, suspicious.id, now))).resolves.toBe(true);
  await expect(resolve(second.cookie)).resolves.toBeNull();
  await expect(resolve(first.cookie)).resolves.toMatchObject({personId: f.personId});
  await expect(tx(f.familyId, (t) => listSessionDisputes(t, f.familyId, f.personId))).resolves.toEqual([
    {sessionId: second.id, at: now},
  ]);
  const thirdDevice = makeDevice();
  await expect(f.login(pin, thirdDevice)).resolves.toEqual({error: "newDevicesLocked"});
  const [own] = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.id, first.id)));
  await expect(f.login(pin, {...thirdDevice, hash: own.deviceHash})).resolves.toHaveProperty("session");
  const fourth = (await f.login(pin, makeDevice())).session!;
  await tx(f.familyId, (t) => endSessions(t, firstViewer, now, true));
  for (const session of [first, second, fourth]) await expect(resolve(session.cookie)).resolves.toBeNull();
});

it("gets reset requests onto the board and replaces the old PIN only on activation", async () => {
  const f = await fixture();
  const original = (await f.issue()).token!;
  const initial = (await f.redeem(original, makeDevice())).session!;
  const member = (await resolve(initial.cookie))!;
  for (let i = 0; i < 4; i++) await tx(f.familyId, (t) => requestPinReset(t, f.familyId, f.personId, makeDevice(), now));
  const board = await tx(f.familyId, (t) => readiness(t, f.viewer, now));
  expect(board?.requests).toHaveLength(3);
  await expect(tx(f.familyId, (t) => readiness(t, member, now))).resolves.toBeNull();
  await expect(tx(f.familyId, (t) => issueKey(t, member, f.personId, "reset", pepper, now))).resolves.toEqual({error: "forbidden"});
  const reset = await f.issue("reset");
  expect((await tx(f.familyId, (t) => readiness(t, f.viewer, now)))?.requests).toHaveLength(3);
  await expect(tx(f.familyId, (t) => markKeySent(t, f.viewer, reset.id!, now))).resolves.toBe(true);
  expect((await tx(f.familyId, (t) => readiness(t, f.viewer, now)))?.requests).toHaveLength(3);
  const otherSession = (await f.login(pin, makeDevice())).session!;
  const replacement = await f.issue("reset");
  await expect(f.redeem(reset.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
  const activation = await f.redeem(replacement.token!, makeDevice(), false, now, newPin);
  expect(activation).toHaveProperty("session");
  expect((await tx(f.familyId, (t) => readiness(t, f.viewer, now)))?.requests).toHaveLength(0);
  await expect(resolve(initial.cookie)).resolves.toBeNull();
  await expect(resolve(otherSession.cookie)).resolves.toBeNull();
  await expect(resolve(activation.session!.cookie)).resolves.toMatchObject({personId: f.personId});
  await expect(f.login(pin, makeDevice())).resolves.toEqual({error: "invalidPin"});
  await expect(f.login(newPin, makeDevice())).resolves.toHaveProperty("session");
  const recovered = (await resolve(activation.session!.cookie))!;
  const {activity} = await tx(f.familyId, (t) => account(t, recovered));
  expect(activity.map(({kind}) => kind)).toEqual(expect.arrayContaining(["keyUsed", "resetPrepared", "resetSent", "resetUsed"]));
});

it("records a forwarded used-key dispute without giving its holder access or replacing the owner", async () => {
  const f = await fixture();
  const key = await f.issue();
  const reportDevice: Device = {...makeDevice(), kind: "computer"};
  const reportAt = new Date(now.getTime() + 1000);
  await expect(tx(f.familyId, (t) => disputeUsedKey(t, f.familyId, key.token!, false, pepper, reportDevice, reportAt)))
    .resolves.toEqual({error: "unavailable"});
  const owner = (await f.redeem(key.token!, makeDevice())).session!;
  const other = (await f.login(pin, makeDevice())).session!;
  const report = () => tx(f.familyId, (t) => disputeUsedKey(t, f.familyId, key.code!, true, pepper, reportDevice, reportAt));
  await expect(report()).resolves.toEqual({success: "keyDisputed"});
  await expect(report()).resolves.toEqual({success: "keyDisputed"});
  const active = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.personId, f.personId)));
  expect(active).toHaveLength(2);
  expect(active.every(({revokedAt}) => revokedAt === null)).toBe(true);
  await expect(f.redeem(key.token!, reportDevice, false, reportAt, newPin)).resolves.toEqual({error: "usedKey"});
  await expect(f.login(newPin, reportDevice)).resolves.toEqual({error: "invalidPin"});
  const records = await tx(f.familyId, (t) => listKeyDisputes(t, f.familyId, f.personId));
  expect(records).toEqual([{keyId: key.id, sessionId: owner.id, deviceKind: "computer", at: reportAt}]);
  for (const session of [owner, other]) {
    const viewer = (await resolve(session.cookie))!;
    expect(viewer).toMatchObject({personId: f.personId});
    const view = await tx(f.familyId, (t) => account(t, viewer));
    const event = view.activity.find(({kind}) => kind === "keyDisputed")!;
    expect(event).toMatchObject({at: reportAt, deviceKind: "computer"});
    await expect(tx(f.familyId, (t) => disputeEvent(t, viewer, event.id, reportAt))).resolves.toBe(false);
  }
  const board = await tx(f.familyId, (t) => readiness(t, f.viewer, reportAt));
  expect(board?.activity).toContainEqual({personId: f.personId, kind: "keyDisputed", deviceKind: "computer", at: reportAt});
  await expect(f.login(pin, makeDevice())).resolves.toHaveProperty("session");
  await expect(resolve(owner.cookie)).resolves.toMatchObject({personId: f.personId});
  await expect(resolve(other.cookie)).resolves.toMatchObject({personId: f.personId});
});

it("recovers a name claimed by someone else only when the organizer's replacement key is redeemed", async () => {
  const f = await fixture();
  const key = await f.issue();
  const intruder = (await f.redeem(key.token!, makeDevice())).session!;
  const intruderOther = (await f.login(pin, makeDevice())).session!;
  const credentialId = secret();
  await tx(f.familyId, (t) => t.insert(passkeys).values({
    familyId: f.familyId, personId: f.personId, id: credentialId, deviceHash: makeDevice().hash,
    publicKey: "fixture", counter: "0",
  }));
  await expect(tx(f.familyId, (t) => disputeUsedKey(t, f.familyId, secret(), false, pepper, makeDevice(), now)))
    .resolves.toEqual({error: "unavailable"});
  await expect(tx(f.familyId, (t) => disputeUsedKey(t, f.familyId, key.token!, false, pepper, makeDevice(), now)))
    .resolves.toEqual({success: "keyDisputed"});
  const reset = await f.issue("reset");
  for (const session of [intruder, intruderOther]) await expect(resolve(session.cookie)).resolves.not.toBeNull();
  const [before] = await tx(f.familyId, (t) => t.select().from(passkeys).where(eq(passkeys.id, credentialId)));
  expect(before.revokedAt).toBeNull();
  const owner = (await f.redeem(reset.token!, makeDevice(), false, now, newPin)).session!;
  await expect(resolve(owner.cookie)).resolves.toMatchObject({personId: f.personId});
  for (const session of [intruder, intruderOther]) await expect(resolve(session.cookie)).resolves.toBeNull();
  const [after] = await tx(f.familyId, (t) => t.select().from(passkeys).where(eq(passkeys.id, credentialId)));
  expect(after.revokedAt).toEqual(now);
  await expect(f.login(pin, makeDevice())).resolves.toEqual({error: "invalidPin"});
  await expect(f.login(newPin, makeDevice())).resolves.toHaveProperty("session");
  await expect(tx(f.familyId, (t) => listKeyDisputes(t, f.familyId, f.personId))).resolves.toEqual([
    {keyId: key.id, sessionId: intruder.id, deviceKind: "iphone", at: now},
  ]);
  const recovered = (await resolve(owner.cookie))!;
  expect((await tx(f.familyId, (t) => account(t, recovered))).activity).toEqual(expect.arrayContaining([
    expect.objectContaining({kind: "keyDisputed"}),
  ]));
  await expect(resolve(f.organizer.cookie)).resolves.toMatchObject({personId: f.viewer.personId});
});

const runOperator = (familyId: string) => promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", familyId], {
  env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_URL, AUTH_SECRET: pepper, AUTH_ORIGIN: "https://exchange.example"},
});

it("lets a co-organizer reset the organizer and refuses operator recovery when a co-organizer is available", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  const key = await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now));
  const coSession = (await f.redeem(key.token!, makeDevice())).session!;
  const coViewer = (await resolve(coSession.cookie))!;
  await expect(runOperator(f.familyId)).rejects.toMatchObject({code: 1, stderr: expect.stringContaining("coOrganizerAvailable")});
  const reset = await tx(f.familyId, (t) => issueKey(t, coViewer, f.viewer.personId, "reset", pepper, now));
  expect(reset).toHaveProperty("token");
  await expect(tx(f.familyId, (t) => markKeySent(t, coViewer, reset.id!, now))).resolves.toBe(true);
  const organizer = (await f.redeem(reset.token!, makeDevice(), false, now, newPin)).session!;
  await expect(resolve(organizer.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  await expect(tx(f.familyId, (t) => signInWithPin(t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now)))
    .resolves.toEqual({error: "invalidPin"});
  await expect(resolve(coSession.cookie)).resolves.toMatchObject({personId: co});
  const oldSession = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.id, f.viewer.sessionId)));
  expect(oldSession[0]).toMatchObject({revokedAt: now, trusted: false});
});

it("issues an organizer recovery link through the operator command for families without a co-organizer", async () => {
  const f = await fixture();
  await expect(runOperator("invalid")).rejects.toMatchObject({code: 1, stderr: expect.stringContaining("Usage:")});
  await expect(runOperator(randomUUID())).rejects.toMatchObject({code: 1, stderr: expect.stringContaining("unavailable")});
  const {stdout} = await runOperator(f.familyId);
  const output = JSON.parse(stdout);
  const url = new URL(output.url);
  expect(url.origin).toBe("https://exchange.example");
  expect(output.familyId).toBe(f.familyId);
  const token = url.pathname.split("~")[1];
  const reset = (await f.redeem(token, makeDevice(), false, now, newPin)).session!;
  await expect(resolve(reset.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  const oldSession = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.id, f.viewer.sessionId)));
  expect(oldSession[0]).toMatchObject({revokedAt: now, trusted: false});
  const viewer = (await resolve(reset.cookie))!;
  await expect(tx(f.familyId, (t) => readiness(t, viewer, now))).resolves.toMatchObject({familyName: "Frostfall"});
});

it("manages households, pairs, co-organizers and helpers inside the family", async () => {
  const f = await fixture();
  const dependent = await f.add("Acorn", f.viewer.personId);
  const co = await f.add("Pinecone");
  await expect(tx(f.familyId, (t) => saveHousehold(t, f.viewer, null, "Fir house"))).resolves.toBeNull();
  const [group] = await tx(f.familyId, (t) => t.select().from(households));
  await expect(tx(f.familyId, (t) => saveMember(t, f.viewer, f.personId, {
    name: "Snowflake", language: "en", helperId: null, householdId: group.id,
  }))).resolves.toBeNull();
  await expect(tx(f.familyId, (t) => changeKeepApart(t, f.viewer, f.personId, co, false))).resolves.toBeNull();
  const before = await tx(f.familyId, (t) => readiness(t, f.viewer, now));
  expect(before?.pairs).toHaveLength(1);
  await expect(tx(f.familyId, (t) => changeKeepApart(t, f.viewer, co, f.personId, true))).resolves.toBeNull();
  await expect(tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co))).resolves.toBeNull();
  const coKey = await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now));
  const coSession = (await f.redeem(coKey.token!, makeDevice())).session!;
  const coViewer = (await resolve(coSession.cookie))!;
  expect(coViewer.isOrganizer).toBe(true);
  await expect(tx(f.familyId, (t) => readiness(t, coViewer, now))).resolves.toMatchObject({canSendKeys: true});
  await expect(tx(f.familyId, (t) => issueKey(t, coViewer, f.personId, "share", pepper, now))).resolves.toHaveProperty("token");
  await expect(tx(f.familyId, (t) => issueKey(t, f.viewer, dependent, "share", pepper, now))).resolves.toEqual({error: "unavailable"});
  await expect(tx(f.familyId, (t) => actFor(t, f.viewer, f.personId))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => actFor(t, f.viewer, dependent))).resolves.toBe(true);
  await expect(tx(f.familyId, (t) => removeMember(t, f.viewer, f.personId, now))).resolves.toBeNull();
  await expect(f.issue()).resolves.toEqual({error: "unavailable"});
});

it("applies row-level family isolation to every auth table", async () => {
  const one = await fixture();
  const two = await fixture();
  const joined = (await two.redeem((await two.issue()).token!, makeDevice())).session!;
  const member = (await resolve(joined.cookie))!;
  const second = (await two.login(pin, makeDevice())).session!;
  const activity = await tx(two.familyId, (t) => account(t, member));
  const event = activity.activity.find(({sessionId}) => sessionId === second.id)!;
  await tx(two.familyId, async (t) => {
    await disputeEvent(t, member, event.id, now);
    await requestPinReset(t, two.familyId, two.personId, makeDevice(), now);
    await allowCodeTry(t, two.familyId, makeDevice(), now);
    await t.insert(passkeys).values({
      familyId: two.familyId, personId: two.personId, id: secret(), deviceHash: digest(secret()), publicKey: "fixture", counter: "0",
    });
  });
  const tables = [sessions, pinCredentials, personalKeys, authLimits, pinResetRequests, passkeys, authEvents, sessionDisputes] as const;
  for (const table of tables) {
    expect(await tx(two.familyId, (t) => t.execute(sql`select * from ${table} where family_id = ${two.familyId}`))
      .then(({rows}) => rows.length)).toBeGreaterThan(0);
    await expect(tx(one.familyId, (t) => t.execute(sql`select * from ${table} where family_id = ${two.familyId}`))
      .then(({rows}) => rows)).resolves.toEqual([]);
  }
  await expect(tx(one.familyId, (t) => t.insert(authEvents).values({familyId: two.familyId, personId: two.personId, kind: "keyUsed"})))
    .rejects.toMatchObject({cause: {code: "42501"}});
});
