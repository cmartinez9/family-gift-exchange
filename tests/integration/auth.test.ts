import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {and, eq, sql} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {requireIssuedKey} from "../helpers/issued-key";
import {withFamily} from "../../src/server/db/client";
import type {FamilyTransaction} from "../../src/server/db/database";
import {claims, families, households, people} from "../../src/server/db/schema";
import {addListItem, getWishlist} from "../../src/server/lists";
import {claimItem, getGettingList, setClaimTick} from "../../src/server/lists/claims";
import {
  allowCodeTry, disputeUsedKey, inspectKey, issueKey, lockFamily, markKeySent, redeemKey, requestPinReset, signInWithPin, type Device
} from "../../src/server/auth/access";
import {createFamily, saveMember, readiness, signInFamily, changeCoOrganizer, saveHousehold, removeMember} from "../../src/server/auth/families";
import {authEvents, authLimits, passkeys, personalKeys, pinCredentials, pinResetRequests, sessionDisputes, sessions} from "../../src/server/auth/schema";
import {findViewer, parseSession, digest, secret} from "../../src/server/auth/session";
import {account, actFor, disputeEvent, disputeSession, endSessions, listKeyDisputes, listSessionDisputes} from "../../src/server/auth/security";
import {createCodePreview} from "../../src/server/auth/code-preview";
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
    tx(familyId, async (t) => {
      const key = typed ? await inspectKey(t, familyId, value, at, pepper) : null;
      const preview = key ? createCodePreview(pepper, familyId, key, value, device.hash) : null;
      return redeemKey(t, {familyId, value, typed, preview, pin: chosenPin, confirmation: chosenPin, pepper, device, currentViewer: null, now: at});
    });
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
  const issued = requireIssuedKey(await f.issue());
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
  const qr = requireIssuedKey(await f.issue("qr"));
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
  const joined = await f.redeem((requireIssuedKey(await f.issue())).token!, trusted);
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
  const first = (await f.redeem((requireIssuedKey(await f.issue())).token!, makeDevice())).session!;
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
  const renewed = (await f.login(pin, {...thirdDevice, hash: own.deviceHash})).session!;
  const fourth = (await f.login(pin, makeDevice())).session!;
  const current = (await resolve(renewed.cookie))!;
  await tx(f.familyId, (t) => endSessions(t, current, now, true));
  for (const session of [first, second, renewed, fourth]) await expect(resolve(session.cookie)).resolves.toBeNull();
});

it("gets reset requests onto the board and replaces the old PIN only on activation", async () => {
  const f = await fixture();
  const original = (requireIssuedKey(await f.issue())).token!;
  const initial = (await f.redeem(original, makeDevice())).session!;
  const member = (await resolve(initial.cookie))!;
  for (let i = 0; i < 4; i++) await tx(f.familyId, (t) => requestPinReset(t, f.familyId, f.personId, makeDevice(), now));
  const board = await tx(f.familyId, (t) => readiness(t, f.viewer, now));
  expect(board?.requests).toHaveLength(3);
  await expect(tx(f.familyId, (t) => readiness(t, member, now))).resolves.toBeNull();
  await expect(tx(f.familyId, (t) => issueKey(t, member, f.personId, "reset", pepper, now))).resolves.toEqual({error: "forbidden"});
  const reset = requireIssuedKey(await f.issue("reset"));
  expect((await tx(f.familyId, (t) => readiness(t, f.viewer, now)))?.requests).toHaveLength(3);
  await expect(tx(f.familyId, (t) => markKeySent(t, f.viewer, reset.id!, now))).resolves.toBe(true);
  expect((await tx(f.familyId, (t) => readiness(t, f.viewer, now)))?.requests).toHaveLength(3);
  const otherSession = (await f.login(pin, makeDevice())).session!;
  const replacement = requireIssuedKey(await f.issue("reset"));
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
  const key = requireIssuedKey(await f.issue());
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
  const key = requireIssuedKey(await f.issue());
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
  const reset = requireIssuedKey(await f.issue("reset"));
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

it("lets a joined co-organizer and the operator recover the organizer", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  const key = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now)));
  const coSession = (await f.redeem(key.token!, makeDevice())).session!;
  const coViewer = (await resolve(coSession.cookie))!;
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, coViewer, f.viewer.personId, "reset", pepper, now)));
  expect(reset).toHaveProperty("token");
  await expect(tx(f.familyId, (t) => markKeySent(t, coViewer, reset.id!, now))).resolves.toBe(true);
  const organizer = (await f.redeem(reset.token!, makeDevice(), false, now, newPin)).session!;
  await expect(resolve(organizer.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  await expect(tx(f.familyId, (t) => signInWithPin(t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now)))
    .resolves.toEqual({error: "invalidPin"});
  await expect(resolve(coSession.cookie)).resolves.toMatchObject({personId: co});
  const oldSession = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.id, f.viewer.sessionId)));
  expect(oldSession[0]).toMatchObject({revokedAt: now, trusted: false});
  const {stdout} = await runOperator(f.familyId);
  const token = new URL(JSON.parse(stdout).url).pathname.split("~")[1];
  const recovered = (await f.redeem(token, makeDevice(), false, now, pin)).session!;
  await expect(resolve(recovered.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  await expect(resolve(organizer.cookie)).resolves.toBeNull();
  await expect(resolve(coSession.cookie)).resolves.toMatchObject({personId: co, isOrganizer: true});
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

it("recovers a signed-out organizer when the appointed co-organizer has not joined", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  await tx(f.familyId, (t) => endSessions(t, f.viewer, now, true));
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  const {stdout} = await runOperator(f.familyId);
  const token = new URL(JSON.parse(stdout).url).pathname.split("~")[1];
  const recovered = (await f.redeem(token, makeDevice(), false, now, newPin)).session!;
  const organizer = (await resolve(recovered.cookie))!;
  expect(organizer).toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  const board = await tx(f.familyId, (t) => readiness(t, organizer, now));
  expect(board?.members.find(({id}) => id === co)).toMatchObject({role: "co_organizer", joinedAt: null});
  const invitation = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, organizer, co, "share", pepper, now)));
  const joined = (await f.redeem(invitation.token!, makeDevice())).session!;
  await expect(resolve(joined.cookie)).resolves.toMatchObject({personId: co, isOrganizer: true});
});

it.each(["prepared", "sent"])("invalidates a %s self-issued reset key when its organizer session is disputed", async (status) => {
  const f = await fixture();
  const intruder = (await tx(f.familyId, (t) => signInWithPin(
    t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now,
  ))).session!;
  const intruderViewer = (await resolve(intruder.cookie))!;
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, intruderViewer, intruderViewer.personId, "reset", pepper, now)));
  if (status === "sent") await expect(tx(f.familyId, (t) => markKeySent(t, intruderViewer, reset.id!, now))).resolves.toBe(true);
  const invitation = requireIssuedKey(await f.issue());
  const [before] = await tx(f.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, f.viewer.personId)));
  const [{id: eventId, keyId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.familyId, f.familyId), eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  expect(keyId).toBeNull();
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, now))).resolves.toBe("lockdown");
  await expect(resolve(intruder.cookie)).resolves.toBeNull();
  await expect(f.redeem(reset.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
  await expect(f.redeem(reset.code!, makeDevice(), true, now, newPin)).resolves.toEqual({error: "unavailable"});
  const [stored] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, reset.id!)));
  expect(stored).toMatchObject({revokedAt: now, usedAt: null});
  const [after] = await tx(f.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, f.viewer.personId)));
  expect(before.pinHash).not.toBeNull();
  expect(after.pinHash).toBeNull();
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  await expect(f.redeem(invitation.token!, makeDevice())).resolves.toEqual({error: "unavailable"});
  const {stdout} = await runOperator(f.familyId);
  const recovery = new URL(JSON.parse(stdout).url).pathname.split("~")[1];
  const recovered = (await f.redeem(recovery, makeDevice(), false, now, newPin)).session!;
  await expect(resolve(recovered.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
});

it("voids co-organizer recovery keys during an organizer lockdown", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  const invitation = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now)));
  const coSession = (await f.redeem(invitation.token!, makeDevice())).session!;
  const coViewer = (await resolve(coSession.cookie))!;
  const intruder = (await tx(f.familyId, (t) => signInWithPin(
    t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now,
  ))).session!;
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, coViewer, f.viewer.personId, "reset", pepper, now)));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, now))).resolves.toBe("lockdown");
  await expect(resolve(intruder.cookie)).resolves.toBeNull();
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  await expect(f.redeem(reset.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
  await expect(resolve(coSession.cookie)).resolves.toBeNull();
});

it("blocks co-organizer takeover and voids every key during an organizer lockdown", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  const invitation = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now)));
  const coSession = (await f.redeem(invitation.token!, makeDevice())).session!;
  const intruder = (await tx(f.familyId, (t) => signInWithPin(
    t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now,
  ))).session!;
  const intruderViewer = (await resolve(intruder.cookie))!;
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, intruderViewer, co, "reset", pepper, now)));
  const badKeys = [reset];
  for (const kind of ["share", "qr", "print"] as const) {
    badKeys.push(requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, intruderViewer, f.personId, kind, pepper, now))));
  }
  const goodInvitation = requireIssuedKey(await f.issue());
  const goodReset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, f.viewer.personId, "reset", pepper, now)));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, now))).resolves.toBe("lockdown");
  for (const key of badKeys) {
    await expect(f.redeem(key.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
    const [stored] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, key.id!)));
    expect(stored).toMatchObject({issuedBySessionId: intruder.id, revokedAt: now, usedAt: null});
  }
  await expect(f.redeem(reset.code!, makeDevice(), true, now, newPin)).resolves.toEqual({error: "unavailable"});
  await expect(resolve(intruder.cookie)).resolves.toBeNull();
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  await expect(resolve(coSession.cookie)).resolves.toBeNull();
  for (const key of [goodInvitation, goodReset]) {
    const [stored] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, key.id!)));
    expect(stored).toMatchObject({issuedBySessionId: f.viewer.sessionId, revokedAt: now, usedAt: null});
  }
  await expect(f.redeem(goodInvitation.token!, makeDevice())).resolves.toEqual({error: "unavailable"});
  await expect(f.redeem(goodReset.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
});

it("revokes keys and cross-identity sessions enabled by an already-redeemed key from the disputed session", async () => {
  const f = await fixture();
  const co = await f.add("Pinecone");
  const other = await f.add("Birch");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co));
  const invitation = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now)));
  await f.redeem(invitation.token!, makeDevice());
  const goodKey = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, other, "print", pepper, now)));
  const intruder = (await tx(f.familyId, (t) => signInWithPin(
    t, f.familyId, f.viewer.personId, pin, pepper, makeDevice(), now,
  ))).session!;
  const intruderViewer = (await resolve(intruder.cookie))!;
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, intruderViewer, co, "reset", pepper, now)));
  const coDevice = makeDevice();
  const descendant = (await f.redeem(reset.token!, coDevice, false, now, newPin)).session!;
  const coViewer = (await resolve(descendant.cookie))!;
  const takeover = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, coViewer, f.viewer.personId, "reset", pepper, now)));
  const memberKey = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, coViewer, f.personId, "share", pepper, now)));
  const memberDevice = makeDevice();
  const member = (await f.redeem(memberKey.token!, memberDevice)).session!;
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, now))).resolves.toBe("lockdown");
  await expect(f.redeem(takeover.token!, makeDevice(), false, now, newPin)).resolves.toEqual({error: "unavailable"});
  for (const session of [intruder, descendant, member]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: now, trusted: false});
  }
  await expect(tx(f.familyId, (t) => issueKey(t, coViewer, f.viewer.personId, "reset", pepper, now)))
    .resolves.toEqual({error: "forbidden"});
  await expect(tx(f.familyId, (t) => signInWithPin(t, f.familyId, co, newPin, pepper, coDevice, now)))
    .resolves.toEqual({error: "needsNewKey"});
  await expect(f.login(pin, memberDevice)).resolves.toEqual({error: "needsNewKey"});
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  await expect(f.redeem(goodKey.token!, makeDevice())).resolves.toEqual({error: "unavailable"});
});

it("rejects queued recovery and revocation requests authenticated before organizer recovery", async () => {
  const f = await fixture();
  const reset = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, f.viewer.personId, "reset", pepper, now)));
  const ready = Promise.withResolvers<{session: {id: string; cookie: string}; eventId: string}>();
  const commit = Promise.withResolvers<void>();
  const recovery = tx(f.familyId, async (t) => {
    await lockFamily(t, f.familyId);
    const result = await redeemKey(t, {
      familyId: f.familyId, value: reset.token!, typed: false, pin: newPin, confirmation: newPin,
      pepper, device: makeDevice(), currentViewer: null, now,
    });
    expect(result).toHaveProperty("session");
    const [event] = await t.select().from(authEvents).where(and(
      eq(authEvents.familyId, f.familyId), eq(authEvents.sessionId, result.session!.id), eq(authEvents.kind, "resetUsed"),
    ));
    ready.resolve({session: result.session!, eventId: event.id});
    await commit.promise;
    return result.session!;
  });
  void recovery.catch(ready.reject);
  const queued: {result: Promise<unknown>; pid: Promise<number>}[] = [];
  try {
    const {eventId} = await ready.promise;
    const mutations: ((t: FamilyTransaction) => Promise<unknown>)[] = [
      (t) => issueKey(t, f.viewer, f.viewer.personId, "reset", pepper, now),
      (t) => disputeEvent(t, f.viewer, eventId, now),
      (t) => endSessions(t, f.viewer, now, true),
    ];
    for (const mutation of mutations) {
      const pid = Promise.withResolvers<number>();
      const result = tx(f.familyId, async (t) => {
        const connection = await t.execute<{pid: number}>(sql`select pg_backend_pid() as pid`);
        pid.resolve(connection.rows[0].pid);
        return mutation(t);
      });
      queued.push({result, pid: pid.promise});
    }
    const pids = await Promise.all(queued.map(({pid}) => pid));
    await vi.waitFor(async () => {
      const blocked = await tx(f.familyId, (t) => t.execute<{waiting: boolean}>(sql`
        select bool_and(cardinality(pg_blocking_pids(pid)) > 0) as waiting
        from unnest(array[${sql.join(pids.map((pid) => sql`${pid}`), sql`, `)}]::integer[]) as pid
      `));
      expect(blocked.rows[0].waiting).toBe(true);
    }, {timeout: 2000, interval: 10});
  } finally {
    commit.resolve();
    await recovery;
    await Promise.allSettled(queued.map(({result}) => result));
  }
  await expect(Promise.all(queued.map(({result}) => result))).resolves.toEqual([{error: "forbidden"}, false, false]);
  const recovered = await recovery;
  await expect(resolve(f.organizer.cookie)).resolves.toBeNull();
  await expect(resolve(recovered.cookie)).resolves.toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  const disputes = await tx(f.familyId, (t) => listSessionDisputes(t, f.familyId, f.viewer.personId));
  expect(disputes).toEqual([]);
  const keys = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.personId, f.viewer.personId)));
  expect(keys).toHaveLength(1);
});

it("rejects an expired viewer even when the request carries its earlier authentication time", async () => {
  const f = await fixture();
  const joined = (await f.redeem((requireIssuedKey(await f.issue())).token!, makeDevice())).session!;
  await tx(f.familyId, (t) => t.update(sessions).set({expiresAt: new Date(Date.now() - 1000)})
    .where(eq(sessions.id, f.viewer.sessionId)));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(eq(authEvents.sessionId, joined.id)));
  await expect(tx(f.familyId, (t) => issueKey(t, f.viewer, f.personId, "reset", pepper, now))).resolves.toEqual({error: "forbidden"});
  await expect(tx(f.familyId, (t) => endSessions(t, f.viewer, now, true))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, now))).resolves.toBe(false);
  await expect(resolve(joined.cookie)).resolves.toMatchObject({personId: f.personId});
});

it("manages households, co-organizers and helpers inside the family", async () => {
  const f = await fixture();
  const dependent = await f.add("Acorn", f.viewer.personId);
  const co = await f.add("Pinecone");
  await expect(tx(f.familyId, (t) => saveHousehold(t, f.viewer, null, "Fir house"))).resolves.toBeNull();
  const [group] = await tx(f.familyId, (t) => t.select().from(households));
  await expect(tx(f.familyId, (t) => saveMember(t, f.viewer, f.personId, {
    name: "Snowflake", language: "en", helperId: null, householdId: group.id,
  }))).resolves.toBeNull();
  await expect(tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co))).resolves.toBeNull();
  const coKey = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, co, "share", pepper, now)));
  const coSession = (await f.redeem(coKey.token!, makeDevice())).session!;
  const coViewer = (await resolve(coSession.cookie))!;
  expect(coViewer.isOrganizer).toBe(true);
  await expect(tx(f.familyId, (t) => readiness(t, coViewer, now))).resolves.toMatchObject({canSendKeys: true});
  await expect(tx(f.familyId, (t) => issueKey(t, coViewer, f.personId, "share", pepper, now))).resolves.toHaveProperty("token");
  await expect(tx(f.familyId, (t) => issueKey(t, f.viewer, dependent, "share", pepper, now))).resolves.toEqual({error: "unavailable"});
  await expect(tx(f.familyId, (t) => actFor(t, f.viewer, f.personId))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => actFor(t, f.viewer, dependent))).resolves.toBe(true);
  await expect(f.issue()).resolves.toEqual({error: "forbidden"});
  await expect(tx(f.familyId, (t) => actFor(t, f.viewer, f.viewer.personId))).resolves.toBe(true);
  await expect(tx(f.familyId, (t) => removeMember(t, f.viewer, f.personId, now))).resolves.toBeNull();
  await expect(f.issue()).resolves.toEqual({error: "unavailable"});
});

it("releases only unpurchased claims on member removal and rolls back with membership", async () => {
  const f = await fixture();
  const joined = (await f.redeem((requireIssuedKey(await f.issue())).token!, makeDevice())).session!;
  const member = (await resolve(joined.cookie))!;
  const remainingId = await f.add("Firleaf");
  const key = requireIssuedKey(await tx(f.familyId, (t) => issueKey(t, f.viewer, remainingId, "share", pepper, now)));
  const remainingSession = (await f.redeem(key.token!, makeDevice())).session!;
  const remaining = (await resolve(remainingSession.cookie))!;
  const pending = await addListItem(f.viewer, f.viewer.personId, {kind: "note", title: "Book"});
  const bought = await addListItem(f.viewer, f.viewer.personId, {kind: "note", title: "Scarf"});
  const other = await addListItem(f.viewer, f.viewer.personId, {kind: "note", title: "Mittens"});
  const ownerBefore = await getWishlist(f.viewer, f.viewer.personId);
  await claimItem(member, pending.id);
  await claimItem(member, bought.id);
  await setClaimTick(member, pending.id, "wrapped", true);
  await setClaimTick(member, bought.id, "bought", true);
  await claimItem(remaining, other.id);
  const beforeRemoval = await getWishlist(remaining, f.viewer.personId);

  await expect(tx(f.familyId, (t) => removeMember(t, member, remainingId, now))).resolves.toBe("forbidden");
  await expect(tx(f.familyId, async (t) => {
    expect(await removeMember(t, f.viewer, f.personId, now)).toBeNull();
    throw new Error("Abort member removal");
  })).rejects.toThrow("Abort member removal");
  expect(await resolve(joined.cookie)).toMatchObject({personId: f.personId});
  expect(await getWishlist(remaining, f.viewer.personId)).toEqual(beforeRemoval);
  expect(await getGettingList(member)).toEqual(expect.arrayContaining([
    expect.objectContaining({itemId: pending.id, bought: false, wrapped: true}),
    expect.objectContaining({itemId: bought.id, bought: true}),
  ]));

  await expect(tx(f.familyId, (t) => removeMember(t, f.viewer, f.personId, now))).resolves.toBeNull();
  expect(await resolve(joined.cookie)).toBeNull();
  const afterRemoval = await getWishlist(remaining, f.viewer.personId);
  expect(afterRemoval.items).toEqual([
    pending, {...bought, claim: "someone"}, {...other, claim: "mine"},
  ]);
  await expect(claimItem(remaining, pending.id)).resolves.toBeUndefined();
  await expect(claimItem(remaining, bought.id)).rejects.toMatchObject({code: "already-claimed"});
  expect(await getWishlist(f.viewer, f.viewer.personId)).toEqual(ownerBefore);
});

it("blocks in-flight claims until member removal commits", async () => {
  const f = await fixture();
  const joined = (await f.redeem((requireIssuedKey(await f.issue())).token!, makeDevice())).session!;
  const member = (await resolve(joined.cookie))!;
  const item = await addListItem(f.viewer, f.viewer.personId, {kind: "note", title: "Candle"});
  const ready = Promise.withResolvers<number>();
  const commit = Promise.withResolvers<void>();
  const removal = tx(f.familyId, async (t) => {
    expect(await removeMember(t, f.viewer, f.personId, now)).toBeNull();
    const result = await t.execute<{pid: number}>(sql`select pg_backend_pid() as pid`);
    ready.resolve(result.rows[0].pid);
    await commit.promise;
  });
  void removal.catch(ready.reject);
  let claim: Promise<void> | undefined;
  try {
    const removerPid = await ready.promise;
    claim = claimItem(member, item.id);
    void claim.catch(() => undefined);
    await vi.waitFor(async () => {
      const result = await tx(f.familyId, (t) => t.execute<{waiting: boolean}>(sql`
        select exists (
          select 1 from pg_stat_activity where ${removerPid}::integer = any(pg_blocking_pids(pid))
        ) as waiting
      `));
      expect(result.rows[0].waiting).toBe(true);
    }, {timeout: 2000, interval: 10});
  } finally {
    commit.resolve();
    await removal;
    if (claim) await Promise.allSettled([claim]);
  }
  await expect(claim).rejects.toMatchObject({code: "forbidden"});
  expect(await tx(f.familyId, (t) => t.select().from(claims).where(and(
    eq(claims.familyId, f.familyId), eq(claims.itemId, item.id),
  )))).toEqual([]);
});

it("applies row-level family isolation to every auth table", async () => {
  const one = await fixture();
  const two = await fixture();
  const joined = (await two.redeem((requireIssuedKey(await two.issue())).token!, makeDevice())).session!;
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

it("only lets a member dispute another session belonging to their own account", async () => {
  const f = await fixture();
  const foreign = await fixture();
  const first = (await f.redeem((requireIssuedKey(await f.issue())).token!, makeDevice())).session!;
  const second = (await f.login(pin, makeDevice())).session!;
  const member = (await resolve(first.cookie))!;
  await expect(tx(f.familyId, (t) => disputeSession(t, f.viewer, second.id, now))).resolves.toBe(false);
  await expect(tx(foreign.familyId, (t) => disputeSession(t, foreign.viewer, second.id, now))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => disputeSession(t, member, first.id, now))).resolves.toBe(false);
  expect(await resolve(second.cookie)).not.toBeNull();
  await expect(tx(f.familyId, (t) => disputeSession(t, member, second.id, now))).resolves.toBe(true);
  expect(await resolve(second.cookie)).toBeNull();
  expect(await resolve(first.cookie)).not.toBeNull();
});
