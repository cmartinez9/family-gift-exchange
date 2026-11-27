import {randomUUID} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {requireIssuedKey} from "../helpers/issued-key";
import {withFamily} from "../../src/server/db/client";
import {families, people} from "../../src/server/db/schema";
import {issueKey, redeemKey, signInDevice, signInWithPin, type Device} from "../../src/server/auth/access";
import {faceIdOnDevice, familyActivity, signedInDevices} from "../../src/server/auth/account";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {authEvents, passkeys, pinCredentials, sessions} from "../../src/server/auth/schema";
import {account, disputeEvent, endSessions, signOutDevice, turnOffFaceId} from "../../src/server/auth/security";
import {digest, findViewer, lastUsedGraceMs, parseSession, secret, touchSession} from "../../src/server/auth/session";

vi.mock("server-only", () => ({}));

// Your phones (U2: sign out one phone) and the Face ID switch (U4: turn it off on this phone).

const pepper = secret();
const pin = "4268";
const cleanup = new Set<string>();
const device = (kind: Device["kind"] = "iphone"): Device => ({hash: digest(secret()), kind, network: null});

afterEach(async () => {
  for (const familyId of cleanup) {
    await withFamily(familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  }
  cleanup.clear();
});

async function resolve(familyId: string, cookie: string) {
  return withFamily(familyId, (t) => findViewer(t, parseSession(cookie)!));
}

/** Christian organizes; Rosa joined on her iPhone and also signed in on an iPad; Beto joined too. */
async function family() {
  const familyId = randomUUID();
  const now = new Date();
  const organizer = await withFamily(familyId, (t) => createFamily(t, {
    familyId, familyName: "Martinez family", displayName: "Christian", language: "en", pin, pepper, device: device(), now,
  }));
  cleanup.add(familyId);
  const manager = (await resolve(familyId, organizer.cookie))!;
  const join = async (name: string) => {
    const phone = device();
    await withFamily(familyId, (t) => saveMember(t, manager, null, {name, language: "en", helperId: null, householdId: null}));
    const [person] = await withFamily(familyId, (t) => t.select({id: people.id}).from(people)
      .where(and(eq(people.familyId, familyId), eq(people.displayName, name))));
    const key = requireIssuedKey(await withFamily(familyId, (t) => issueKey(t, manager, person.id, "share", pepper, now)));
    const result = await withFamily(familyId, (t) => redeemKey(t, {
      familyId, value: key.token, typed: false, pepper, pin, confirmation: pin, device: phone, currentViewer: null, now,
    }));
    const cookie = result.session!.cookie;
    return {personId: person.id, phone, cookie, viewer: (await resolve(familyId, cookie))!};
  };
  const rosa = await join("Rosa");
  const beto = await join("Beto");
  const ipad = device("ipad");
  const ipadSession = await withFamily(familyId, (t) => signInDevice(t, familyId, rosa.personId, ipad, new Date(Date.now() + 1000)));
  return {familyId, manager, rosa, beto, ipad, ipadSession};
}

async function enroll(familyId: string, personId: string, on: Device) {
  const id = secret();
  await withFamily(familyId, (t) => t.insert(passkeys).values({
    familyId, id, personId, deviceHash: on.hash, publicKey: secret(), counter: "0", enrolledAt: new Date(),
  }));
  return id;
}

async function liveCredentials(familyId: string) {
  const rows = await withFamily(familyId, (t) => t.select({id: passkeys.id, revokedAt: passkeys.revokedAt}).from(passkeys));
  return new Set(rows.filter(({revokedAt}) => !revokedAt).map(({id}) => id));
}

async function events(familyId: string, personId: string) {
  return withFamily(familyId, (t) => t.select({kind: authEvents.kind, sessionId: authEvents.sessionId, deviceKind: authEvents.deviceKind})
    .from(authEvents).where(and(eq(authEvents.familyId, familyId), eq(authEvents.personId, personId))));
}

it("signs out only the chosen phone, which is no longer remembered", async () => {
  const {familyId, rosa, beto, ipad, ipadSession} = await family();
  const face = await enroll(familyId, rosa.personId, ipad);
  const [pinBefore] = await withFamily(familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, rosa.personId)));

  await expect(withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, ipadSession.id, new Date())))
    .resolves.toEqual({deviceKind: "ipad"});

  // the iPad can't open anything now; Rosa's iPhone and Beto are still in
  await expect(resolve(familyId, ipadSession.cookie)).resolves.toBeNull();
  await expect(resolve(familyId, rosa.cookie)).resolves.not.toBeNull();
  expect((await withFamily(familyId, (t) => signedInDevices(t, rosa.viewer, new Date()))).map(({kind, current}) => [kind, current]))
    .toEqual([["iphone", true]]);
  expect(await withFamily(familyId, (t) => signedInDevices(t, beto.viewer, new Date()))).toHaveLength(1);
  // Face ID on the iPad and the PIN are untouched
  expect((await liveCredentials(familyId)).has(face)).toBe(true);
  const [pinAfter] = await withFamily(familyId, (t) => t.select().from(pinCredentials).where(eq(pinCredentials.personId, rosa.personId)));
  expect(pinAfter).toEqual(pinBefore);

  // recorded like other sign-in events: on Rosa's own notices, and anonymously for the family
  expect(await events(familyId, rosa.personId)).toContainEqual({kind: "deviceSignedOut", sessionId: rosa.viewer.sessionId, deviceKind: "ipad"});
  const activity = await withFamily(familyId, (t) => familyActivity(t, familyId));
  const signedOut = activity.filter(({kind}) => kind === "signedOut");
  expect(signedOut).toHaveLength(1);
  expect(signedOut[0]).not.toHaveProperty("name");

  // signing in there again is a new phone, with the notice that brings
  await withFamily(familyId, (t) => signInWithPin(t, familyId, rosa.personId, pin, pepper, ipad, new Date()));
  const newDevices = (await events(familyId, rosa.personId)).filter(({kind, deviceKind}) => kind === "newDevice" && deviceKind === "ipad");
  expect(newDevices).toHaveLength(2);
});

it("refuses this phone, someone else's phone, and a phone already signed out", async () => {
  const {familyId, rosa, beto, ipadSession} = await family();
  await expect(withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, rosa.viewer.sessionId, new Date()))).resolves.toBeNull();
  await expect(withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, beto.viewer.sessionId, new Date()))).resolves.toBeNull();
  await expect(withFamily(familyId, (t) => signOutDevice(t, beto.viewer, ipadSession.id, new Date()))).resolves.toBeNull();
  await expect(withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, randomUUID(), new Date()))).resolves.toBeNull();
  await expect(resolve(familyId, beto.cookie)).resolves.not.toBeNull();
  await expect(resolve(familyId, ipadSession.cookie)).resolves.not.toBeNull();
  await withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, ipadSession.id, new Date()));
  await expect(withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, ipadSession.id, new Date()))).resolves.toBeNull();
  expect((await events(familyId, rosa.personId)).filter(({kind}) => kind === "deviceSignedOut")).toHaveLength(1);
  // a phone that was signed out can't sign anything else out
  const ipadViewer = {...rosa.viewer, sessionId: ipadSession.id};
  await expect(withFamily(familyId, (t) => signOutDevice(t, ipadViewer, rosa.viewer.sessionId, new Date()))).resolves.toBeNull();
});

it("leaves sign out everywhere and \"That wasn't me\" as they were", async () => {
  const {familyId, rosa, ipad, ipadSession} = await family();
  const face = await enroll(familyId, rosa.personId, ipad);
  await withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, ipadSession.id, new Date()));
  const {activity} = await withFamily(familyId, (t) => account(t, rosa.viewer));
  // the record of signing a phone out is not something to report
  const own = activity.find(({kind}) => kind === "deviceSignedOut")!;
  await expect(withFamily(familyId, (t) => disputeEvent(t, rosa.viewer, own.id, new Date()))).resolves.toBe(false);
  // the iPad's sign-in can still be reported, and still takes its Face ID with it
  const ipadSignIn = activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === ipadSession.id)!;
  await expect(withFamily(familyId, (t) => disputeEvent(t, rosa.viewer, ipadSignIn.id, new Date()))).resolves.toBe(true);
  expect((await liveCredentials(familyId)).has(face)).toBe(false);
  await expect(resolve(familyId, rosa.cookie)).resolves.not.toBeNull();
  // and everywhere still means every phone, this one too
  await withFamily(familyId, (t) => endSessions(t, rosa.viewer, new Date(), true));
  expect(await withFamily(familyId, (t) => signedInDevices(t, rosa.viewer, new Date()))).toEqual([]);
});

it("turns Face ID off for this phone only, keeping the PIN, sessions and other phones' Face ID", async () => {
  const {familyId, rosa, beto, ipad, ipadSession} = await family();
  const here = await enroll(familyId, rosa.personId, rosa.phone);
  const onIpad = await enroll(familyId, rosa.personId, ipad);
  const betos = await enroll(familyId, beto.personId, beto.phone);
  // the home-screen app keeps its own cookies: a second session on this iPhone that signed in with the same passkey
  const app = device();
  const appSession = await withFamily(familyId, (t) => signInDevice(t, familyId, rosa.personId, app, new Date(), here));
  const appViewer = (await resolve(familyId, appSession.cookie))!;
  await expect(withFamily(familyId, (t) => faceIdOnDevice(t, appViewer))).resolves.toBe(true);

  await expect(withFamily(familyId, (t) => turnOffFaceId(t, appViewer, new Date()))).resolves.toEqual({credentials: [here]});

  const live = await liveCredentials(familyId);
  expect([live.has(here), live.has(onIpad), live.has(betos)]).toEqual([false, true, true]);
  await expect(withFamily(familyId, (t) => faceIdOnDevice(t, appViewer))).resolves.toBe(false);
  await expect(withFamily(familyId, (t) => faceIdOnDevice(t, rosa.viewer))).resolves.toBe(false);
  // nobody was signed out, and the PIN still opens a new session
  for (const cookie of [appSession.cookie, ipadSession.cookie]) await expect(resolve(familyId, cookie)).resolves.not.toBeNull();
  await expect(resolve(familyId, rosa.cookie)).resolves.not.toBeNull();
  const back = await withFamily(familyId, (t) => signInWithPin(t, familyId, rosa.personId, pin, pepper, device(), new Date()));
  expect(back).toHaveProperty("session");

  expect((await events(familyId, rosa.personId)).filter(({kind}) => kind === "faceIdOff"))
    .toEqual([{kind: "faceIdOff", sessionId: appViewer.sessionId, deviceKind: "iphone"}]);
  const activity = await withFamily(familyId, (t) => familyActivity(t, familyId));
  const off = activity.filter(({kind}) => kind === "faceOff");
  expect(off).toHaveLength(1);
  expect(off[0]).not.toHaveProperty("name");
  const {activity: notices} = await withFamily(familyId, (t) => account(t, appViewer));
  const own = notices.find(({kind}) => kind === "faceIdOff")!;
  await expect(withFamily(familyId, (t) => disputeEvent(t, appViewer, own.id, new Date()))).resolves.toBe(false);

  // already off: nothing more to remove or record; turning it on again is the usual enrollment
  await expect(withFamily(familyId, (t) => turnOffFaceId(t, appViewer, new Date()))).resolves.toEqual({credentials: []});
  expect((await events(familyId, rosa.personId)).filter(({kind}) => kind === "faceIdOff")).toHaveLength(1);
  await enroll(familyId, rosa.personId, app);
  await expect(withFamily(familyId, (t) => faceIdOnDevice(t, appViewer))).resolves.toBe(true);
});

it("keeps Face ID on while the PIN can't get the person back in", async () => {
  const {familyId, rosa} = await family();
  const here = await enroll(familyId, rosa.personId, rosa.phone);
  await withFamily(familyId, (t) => t.update(pinCredentials).set({pinHash: null}).where(eq(pinCredentials.personId, rosa.personId)));
  await expect(withFamily(familyId, (t) => turnOffFaceId(t, rosa.viewer, new Date()))).resolves.toEqual({error: "faceOnlyWay"});
  await withFamily(familyId, (t) => t.update(pinCredentials).set({pinHash: "kept"}).where(eq(pinCredentials.personId, rosa.personId)));
  await withFamily(familyId, (t) => t.update(people).set({needsNewKey: true}).where(eq(people.id, rosa.personId)));
  await expect(withFamily(familyId, (t) => turnOffFaceId(t, rosa.viewer, new Date()))).resolves.toEqual({error: "faceOnlyWay"});
  expect((await liveCredentials(familyId)).has(here)).toBe(true);
  expect((await events(familyId, rosa.personId)).some(({kind}) => kind === "faceIdOff")).toBe(false);
});

it("refuses a signed-out phone", async () => {
  const {familyId, rosa, ipad, ipadSession} = await family();
  const onIpad = await enroll(familyId, rosa.personId, ipad);
  await withFamily(familyId, (t) => signOutDevice(t, rosa.viewer, ipadSession.id, new Date()));
  const ipadViewer = {...rosa.viewer, sessionId: ipadSession.id};
  await expect(withFamily(familyId, (t) => turnOffFaceId(t, ipadViewer, new Date()))).resolves.toEqual({error: "unavailable"});
  expect((await liveCredentials(familyId)).has(onIpad)).toBe(true);
});

it("shows when each phone was last used, recording a visit at most every few minutes", async () => {
  const {familyId, rosa, ipadSession} = await family();
  const ipadViewer = (await resolve(familyId, ipadSession.cookie))!;
  const later = new Date(Date.now() + 60 * 60_000);
  await withFamily(familyId, (t) => touchSession(t, ipadViewer, later));
  await withFamily(familyId, (t) => touchSession(t, ipadViewer, new Date(later.getTime() + lastUsedGraceMs - 1000)));
  const [row] = await withFamily(familyId, (t) => t.select({at: sessions.lastUsedAt}).from(sessions).where(eq(sessions.id, ipadSession.id)));
  expect(row.at).toEqual(later);
  const phones = await withFamily(familyId, (t) => signedInDevices(t, rosa.viewer, later));
  expect(phones.find(({kind}) => kind === "ipad")?.lastUsed).toEqual(later);
  await withFamily(familyId, (t) => touchSession(t, ipadViewer, new Date(later.getTime() + lastUsedGraceMs + 1000)));
  const [moved] = await withFamily(familyId, (t) => t.select({at: sessions.lastUsedAt}).from(sessions).where(eq(sessions.id, ipadSession.id)));
  expect(moved.at!.getTime()).toBe(later.getTime() + lastUsedGraceMs + 1000);
});
