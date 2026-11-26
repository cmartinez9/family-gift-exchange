import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {and, eq} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {withFamily} from "../../src/server/db/client";
import {families, people} from "../../src/server/db/schema";
import {createFamily, changeCoOrganizer, saveMember} from "../../src/server/auth/families";
import {issueKey, issueOrganizerKey, markKeySent, redeemKey, signInWithPin, type Device, type KeyKind} from "../../src/server/auth/access";
import {account, disputeEvent, endSessions} from "../../src/server/auth/security";
import {authEvents, passkeys, personalKeys, pinCredentials, sessionDisputes, sessions} from "../../src/server/auth/schema";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {createCodePreview} from "../../src/server/auth/code-preview";
import type {Viewer} from "../../src/server/auth";

vi.mock("server-only", () => ({}));

const pepper = secret();
const pin = "4268";
const replacementPin = "6285";
const cleanup = new Set<string>();
const device = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});
const tx = withFamily;

async function resolve(cookie: string) {
  const parsed = parseSession(cookie)!;
  return tx(parsed.familyId, (t) => findViewer(t, parsed));
}

async function fixture() {
  const familyId = randomUUID();
  const start = Date.now() - 3_600_000;
  const at = (minute: number) => new Date(start + minute * 60_000);
  const ownerDevice = device();
  const owner = await tx(familyId, (t) => createFamily(t, {
    familyId, familyName: "Lockdown fixture", displayName: "Organizer", language: "en", pin, pepper,
    device: ownerDevice, now: at(0),
  }));
  cleanup.add(familyId);
  const viewer = (await resolve(owner.cookie))!;
  const issue = (issuer: Viewer, personId: string, kind: KeyKind = "share", when = at(0)) =>
    tx(familyId, (t) => issueKey(t, issuer, personId, kind, pepper, when));
  const redeem = (value: string, phone: Device, when = at(0), chosenPin = pin) => tx(familyId, (t) => redeemKey(t, {
    familyId, value, typed: false, pin: chosenPin, confirmation: chosenPin, pepper,
    device: phone, currentViewer: null, now: when,
  }));
  const login = (personId: string, phone: Device, when = at(0), chosenPin = pin) =>
    tx(familyId, (t) => signInWithPin(t, familyId, personId, chosenPin, pepper, phone, when));
  const add = async (name: string, joined = true, when = at(0)) => {
    await tx(familyId, (t) => saveMember(t, viewer, null, {name, language: "en", helperId: null, householdId: null}));
    const [person] = await tx(familyId, (t) => t.select().from(people).where(eq(people.displayName, name)));
    const phone = device();
    const key = joined ? await issue(viewer, person.id, "share", when) : null;
    const session = key ? (await redeem(key.token!, phone, when)).session! : null;
    return {id: person.id, phone, session};
  };
  return {familyId, owner, viewer, ownerDevice, at, issue, redeem, login, add};
}

afterEach(async () => {
  for (const familyId of cleanup) await tx(familyId, (t) => t.delete(families).where(eq(families.id, familyId)));
  cleanup.clear();
});

it.each(["unredeemed key", "PIN descendant", "appointment"])("locks down the family after an organizer dispute with a %s takeover", async (chain) => {
  const f = await fixture();
  const untouched = await fixture();
  const co = await f.add("Co-organizer");
  const safe = await f.add("Safe member");
  const changed = await f.add("Recent member", true, f.at(4));
  if (chain !== "appointment") await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co.id, f.at(1)));
  const oldPasskey = secret();
  const newPasskey = secret();
  await tx(f.familyId, (t) => t.insert(passkeys).values([
    {familyId: f.familyId, personId: safe.id, id: oldPasskey, deviceHash: safe.phone.hash, publicKey: "fixture", counter: "0", enrolledAt: f.at(1)},
    {familyId: f.familyId, personId: co.id, id: newPasskey, deviceHash: co.phone.hash, publicKey: "fixture", counter: "0", enrolledAt: f.at(4)},
  ]));
  const intruder = (await f.login(f.viewer.personId, device(), f.at(3))).session!;
  const intruderViewer = (await resolve(intruder.cookie))!;
  let takeover;
  if (chain === "appointment") {
    await tx(f.familyId, (t) => changeCoOrganizer(t, intruderViewer, co.id, f.at(4)));
    takeover = await f.issue((await resolve(co.session!.cookie))!, f.viewer.personId, "reset", f.at(5));
  } else {
    const reset = await f.issue(intruderViewer, co.id, "reset", f.at(4));
    if (chain === "PIN descendant") {
      await f.redeem(reset.token!, device(), f.at(5), replacementPin);
      const descendant = (await f.login(co.id, device(), f.at(6), replacementPin)).session!;
      takeover = await f.issue((await resolve(descendant.cookie))!, f.viewer.personId, "reset", f.at(7));
    } else takeover = reset;
  }
  const pending = await f.issue(f.viewer, safe.id, "reset", f.at(8));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, f.at(9)))).resolves.toBe("lockdown");
  const storedSessions = await tx(f.familyId, (t) => t.select().from(sessions));
  expect(storedSessions.every(({revokedAt}) => revokedAt !== null)).toBe(true);
  expect(storedSessions.find(({id}) => id === intruder.id)?.trusted).toBe(false);
  expect(storedSessions.find(({id}) => id === safe.session!.id)?.trusted).toBe(true);
  await expect(resolve(f.owner.cookie)).resolves.toBeNull();
  await expect(resolve(co.session!.cookie)).resolves.toBeNull();
  await expect(resolve(safe.session!.cookie)).resolves.toBeNull();
  await expect(resolve(untouched.owner.cookie)).resolves.toMatchObject({familyId: untouched.familyId});
  await expect(f.redeem(takeover.token!, device(), f.at(10), replacementPin)).resolves.toEqual({error: "unavailable"});
  await expect(f.redeem(pending.token!, device(), f.at(10))).resolves.toEqual({error: "unavailable"});
  const credentials = await tx(f.familyId, (t) => t.select().from(passkeys));
  expect(credentials.find(({id}) => id === oldPasskey)?.revokedAt).toBeNull();
  expect(credentials.find(({id}) => id === newPasskey)?.revokedAt).toEqual(f.at(9));
  const members = await tx(f.familyId, (t) => t.select().from(people));
  expect(members.find(({id}) => id === changed.id)?.needsNewKey).toBe(true);
  expect(members.find(({id}) => id === safe.id)?.needsNewKey).toBe(false);
  expect(members.find(({id}) => id === co.id)?.role).toBe(chain === "appointment" ? "member" : "co_organizer");
  const [recentPin] = await tx(f.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, changed.id)));
  expect(recentPin.pinHash).toBeNull();
  await expect(f.login(changed.id, device(), f.at(10))).resolves.toEqual({error: "needsNewKey"});
  await expect(f.login(f.viewer.personId, device(), f.at(10))).resolves.toEqual({error: "needsNewKey"});
  const returned = (await f.login(safe.id, device(), f.at(10))).session!;
  const returnedViewer = (await resolve(returned.cookie))!;
  const view = await tx(f.familyId, (t) => account(t, returnedViewer));
  expect(view.activity.filter(({kind}) => kind === "familyLockdown")).toHaveLength(1);
  if (chain === "appointment") {
    const formerCo = (await f.login(co.id, device(), f.at(10))).session!;
    await expect(f.issue((await resolve(formerCo.cookie))!, f.viewer.personId, "reset", f.at(10))).resolves.toEqual({error: "forbidden"});
  }
  const {stdout} = await promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", f.familyId], {
    env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_URL, AUTH_SECRET: pepper, AUTH_ORIGIN: "https://exchange.example"},
  });
  const token = new URL(JSON.parse(stdout).url).pathname.split("~")[1];
  const recovery = (await f.redeem(token, device(), f.at(11), replacementPin)).session!;
  const organizer = (await resolve(recovery.cookie))!;
  expect(organizer).toMatchObject({personId: f.viewer.personId, isOrganizer: true});
  const [restored] = await tx(f.familyId, (t) => t.select().from(people).where(eq(people.id, organizer.personId)));
  expect(restored.needsNewKey).toBe(false);
}, 15000);

it("preserves keys from historical issuing sessions during a member dispute", async () => {
  const f = await fixture();
  const formerCo = await f.add("Former co-organizer");
  const recipient = await f.add("Recipient", false);
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, formerCo.id, f.at(1)));
  const oldViewer = (await resolve(formerCo.session!.cookie))!;
  const historical = await f.issue(oldViewer, recipient.id, "print", f.at(2));
  await tx(f.familyId, (t) => endSessions(t, oldViewer, f.at(3), true));
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, null, f.at(4)));
  const reporter = (await f.login(formerCo.id, device(), f.at(5))).session!;
  const reporterViewer = (await resolve(reporter.cookie))!;
  const intruder = (await f.login(formerCo.id, formerCo.phone, f.at(6))).session!;
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, reporterViewer, eventId, f.at(7)))).resolves.toBe(true);
  await expect(resolve(intruder.cookie)).resolves.toBeNull();
  await expect(resolve(reporter.cookie)).resolves.toMatchObject({personId: formerCo.id});
  await expect(resolve(f.owner.cookie)).resolves.toMatchObject({isOrganizer: true});
  const [stored] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, historical.id!)));
  expect(stored.revokedAt).toBeNull();
  const joined = (await f.redeem(historical.token!, device(), f.at(8))).session!;
  await expect(resolve(joined.cookie)).resolves.toMatchObject({personId: recipient.id});
});

it("applies family lockdown when the reported account is a co-organizer", async () => {
  const f = await fixture();
  const co = await f.add("Co-organizer");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co.id, f.at(1)));
  const reporter = (await resolve(co.session!.cookie))!;
  const intruder = (await f.login(co.id, device(), f.at(3))).session!;
  const key = await f.issue((await resolve(intruder.cookie))!, f.viewer.personId, "reset", f.at(4));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, reporter, eventId, f.at(5)))).resolves.toBe("lockdown");
  for (const session of [f.owner, co.session!, intruder]) await expect(resolve(session.cookie)).resolves.toBeNull();
  await expect(f.redeem(key.token!, device(), f.at(6))).resolves.toEqual({error: "unavailable"});
});

it("uses the earliest disputed session as the cutoff across successive lockdowns", async () => {
  const f = await fixture();
  const safe = await f.add("Member", true, f.at(2.5));
  const passkeyId = secret();
  await tx(f.familyId, (t) => t.insert(passkeys).values({
    familyId: f.familyId, personId: safe.id, id: passkeyId, deviceHash: safe.phone.hash,
    publicKey: "fixture", counter: "0", enrolledAt: f.at(2.5),
  }));
  const earlier = (await f.login(f.viewer.personId, device(), f.at(2))).session!;
  const later = (await f.login(f.viewer.personId, device(), f.at(3))).session!;
  const eventFor = async (id: string) => (await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, id), eq(authEvents.kind, "newDevice"),
  ))))[0].id;
  await expect(tx(f.familyId, async (t) => disputeEvent(t, f.viewer, await eventFor(later.id), f.at(4)))).resolves.toBe("lockdown");
  const [preserved] = await tx(f.familyId, (t) => t.select().from(passkeys).where(eq(passkeys.id, passkeyId)));
  expect(preserved.revokedAt).toBeNull();
  const {stdout} = await promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", f.familyId], {
    env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_URL, AUTH_SECRET: pepper, AUTH_ORIGIN: "https://exchange.example"},
  });
  const recovered = (await f.redeem(new URL(JSON.parse(stdout).url).pathname.split("~")[1], device(), f.at(5))).session!;
  const organizer = (await resolve(recovered.cookie))!;
  await expect(tx(f.familyId, async (t) => disputeEvent(t, organizer, await eventFor(earlier.id), f.at(6)))).resolves.toBe("lockdown");
  const [revoked] = await tx(f.familyId, (t) => t.select().from(passkeys).where(eq(passkeys.id, passkeyId)));
  expect(revoked.revokedAt).toEqual(f.at(6));
  const [credential] = await tx(f.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, safe.id)));
  expect(credential.pinHash).toBeNull();
});

it.each([
  {role: "organizer", kind: "resetPreparedWithoutRequest"},
  {role: "organizer", kind: "resetSent"},
  {role: "co-organizer", kind: "resetPreparedWithoutRequest"},
  {role: "co-organizer", kind: "resetSent"},
] as const)("locks down an unredeemed $role key reported through $kind activity", async ({role, kind}) => {
  const f = await fixture();
  const co = await f.add("Co-organizer");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co.id, f.at(1)));
  const reporter = role === "organizer" ? f.viewer : (await resolve(co.session!.cookie))!;
  const intruder = (await f.login(reporter.personId, device(), f.at(3))).session!;
  const intruderViewer = (await resolve(intruder.cookie))!;
  const recent = await f.add("Recent member", true, f.at(3.5));
  const selfReset = await f.issue(intruderViewer, reporter.personId, "reset", f.at(4));
  const takeover = await f.issue(intruderViewer, role === "organizer" ? co.id : f.viewer.personId, "reset", f.at(5));
  if (kind === "resetSent") await expect(tx(f.familyId, (t) => markKeySent(t, intruderViewer, selfReset.id!, f.at(5)))).resolves.toBe(true);
  const [key] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, selfReset.id!)));
  expect(key.usedSessionId).toBeNull();
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.keyId, selfReset.id!), eq(authEvents.kind, kind),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, reporter, eventId, f.at(6)))).resolves.toBe("lockdown");
  for (const session of [f.owner, co.session!, intruder]) await expect(resolve(session.cookie)).resolves.toBeNull();
  for (const reset of [selfReset, takeover]) await expect(f.redeem(reset.token!, device(), f.at(7))).resolves.toEqual({error: "unavailable"});
  const [record] = await tx(f.familyId, (t) => t.select().from(sessionDisputes).where(eq(sessionDisputes.eventId, eventId)));
  expect(record.disputedSessionId).toBe(intruder.id);
  const [member] = await tx(f.familyId, (t) => t.select().from(people).where(eq(people.id, recent.id)));
  expect(member.needsNewKey).toBe(true);
});

it("locks down an organizer key report with no issuing or redeeming session", async () => {
  const f = await fixture();
  const recovery = await tx(f.familyId, (t) => issueOrganizerKey(t, f.familyId, pepper, f.at(4)));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(eq(authEvents.keyId, recovery.id!)));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, f.at(5)))).resolves.toBe("lockdown");
  await expect(resolve(f.owner.cookie)).resolves.toBeNull();
  await expect(f.redeem(recovery.token!, device(), f.at(6))).resolves.toEqual({error: "unavailable"});
});

it("preserves known-phone PIN recovery and previous device restrictions through lockdown", async () => {
  const f = await fixture();
  const member = await f.add("PIN-only member");
  const badPhone = device();
  const badSession = (await f.login(member.id, badPhone, f.at(1))).session!;
  const [{id: memberEvent}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, badSession.id), eq(authEvents.kind, "newDevice"),
  )));
  const knownSession = (await f.login(member.id, member.phone, f.at(1.5))).session!;
  const reporter = (await resolve(knownSession.cookie))!;
  await expect(tx(f.familyId, (t) => disputeEvent(t, reporter, memberEvent, f.at(2)))).resolves.toBe(true);
  await tx(f.familyId, (t) => t.update(sessions).set({expiresAt: f.at(3)}).where(eq(sessions.id, member.session!.id)));
  const intruder = (await f.login(f.viewer.personId, device(), f.at(4))).session!;
  const [{id: organizerEvent}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, organizerEvent, f.at(5)))).resolves.toBe("lockdown");
  const stored = await tx(f.familyId, (t) => t.select().from(sessions).where(eq(sessions.personId, member.id)));
  expect(stored.find(({id}) => id === knownSession.id)).toMatchObject({revokedAt: f.at(5), trusted: true});
  expect(stored.find(({id}) => id === badSession.id)?.trusted).toBe(false);
  await expect(resolve(knownSession.cookie)).resolves.toBeNull();
  const [credential] = await tx(f.familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, member.id)));
  expect(credential.newDevicesLocked).toBe(true);
  expect(credential.pinHash).not.toBeNull();
  await expect(f.login(member.id, badPhone, f.at(6))).resolves.toEqual({error: "newDevicesLocked"});
  await expect(f.login(member.id, device(), f.at(6))).resolves.toEqual({error: "newDevicesLocked"});
  const returned = (await f.login(member.id, member.phone, f.at(6))).session!;
  await expect(resolve(returned.cookie)).resolves.toMatchObject({personId: member.id});
});

it("keeps an unchanged co-organizer appointment's original grant time through lockdown", async () => {
  const f = await fixture();
  const co = await f.add("Co-organizer");
  await tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co.id, f.at(1)));
  const intruder = (await f.login(f.viewer.personId, device(), f.at(3))).session!;
  await expect(tx(f.familyId, (t) => changeCoOrganizer(t, f.viewer, co.id, f.at(4)))).resolves.toBeNull();
  const [before] = await tx(f.familyId, (t) => t.select().from(people).where(eq(people.id, co.id)));
  expect(before.coOrganizerGrantedAt).toEqual(f.at(1));
  const [{id: eventId}] = await tx(f.familyId, (t) => t.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(tx(f.familyId, (t) => disputeEvent(t, f.viewer, eventId, f.at(5)))).resolves.toBe("lockdown");
  const [after] = await tx(f.familyId, (t) => t.select().from(people).where(eq(people.id, co.id)));
  expect(after).toMatchObject({role: "co_organizer", coOrganizerGrantedAt: f.at(1)});
});

it("accepts slow PIN entry only for the exact key and device bound into a typed-code preview", async () => {
  const f = await fixture();
  const first = await f.add("First", false);
  const second = await f.add("Second", false);
  const one = await f.issue(f.viewer, first.id, "print");
  const two = await f.issue(f.viewer, second.id, "print");
  const phone = device();
  const previewedAt = new Date();
  const proof = createCodePreview(pepper, f.familyId, {id: one.id!, personId: first.id}, one.code!, phone.hash);
  const redeem = (value: string, preview: string | null, chosenDevice = phone, at = f.at(1)) => tx(f.familyId, (t) => redeemKey(t, {
    familyId: f.familyId, value, typed: true, preview, pin, confirmation: pin, pepper, device: chosenDevice, currentViewer: null, now: at,
  }));
  await expect(redeem(two.code!, proof)).resolves.toEqual({error: "previewAgain"});
  await expect(redeem(one.code!, proof, device())).resolves.toEqual({error: "previewAgain"});
  await expect(redeem(one.code!, null)).resolves.toEqual({error: "previewAgain"});
  await expect(redeem(one.code!, `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`)).resolves.toEqual({error: "previewAgain"});
  const joined = (await redeem(one.code!, proof, phone, new Date(previewedAt.getTime() + 30 * 60_000))).session!;
  await expect(resolve(joined.cookie)).resolves.toMatchObject({personId: first.id});
  const [other] = await tx(f.familyId, (t) => t.select().from(personalKeys).where(eq(personalKeys.id, two.id!)));
  expect(other.usedAt).toBeNull();
});
