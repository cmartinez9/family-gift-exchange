import {createHash, generateKeyPairSync, randomUUID, sign} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import type {AuthenticationResponseJSON, RegistrationResponseJSON} from "@simplewebauthn/server";
import {withFamily} from "../../src/server/db/client";
import {families, people} from "../../src/server/db/schema";
import {changeCoOrganizer, createFamily, readiness, saveMember} from "../../src/server/auth/families";
import {digest, findViewer, parseSession, secret, sessionCookie} from "../../src/server/auth/session";
import {authEvents, passkeys, pinCredentials, sessions} from "../../src/server/auth/schema";
import {account, disputeEvent} from "../../src/server/auth/security";
import {getViewer, type Viewer} from "../../src/server/auth";
import {requestDevice, setSession} from "../../src/server/auth/request";
import {issueKey, redeemKey, signInWithPin, type Device} from "../../src/server/auth/access";
import {authenticationFinish, authenticationStart, registrationFinish, registrationStart} from "../../src/server/auth/webauthn";
import {forgotPin} from "../../src/app/[locale]/sign-in/actions";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieValues.has(name) ? {value: cookieValues.get(name)!} : undefined,
    set: (name: string, value: string) => { cookieValues.set(name, value); },
  }),
  headers: async () => new Headers({"user-agent": "Regression test"}),
}));

const cookieValues = new Map<string, string>();
const cleanup = new Set<string>();
const pepper = secret();
const origin = "https://exchange.example";
const pin = "4268";
const device = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});

async function resolve(cookie: string) {
  const parsed = parseSession(cookie)!;
  return withFamily(parsed.familyId, (tx) => findViewer(tx, parsed));
}

async function fixture(organizer = false) {
  const familyId = randomUUID();
  const session = await withFamily(familyId, (tx) => createFamily(tx, {
    familyId, familyName: "Passkey fixture", displayName: "Northstar", language: "en", pin, pepper,
    device: device(), now: new Date(),
  }));
  cleanup.add(familyId);
  const manager = (await resolve(session.cookie))!;
  if (organizer) return {familyId, viewer: manager, session};
  await withFamily(familyId, (tx) => saveMember(tx, manager, null, {name: "Member", language: "en", helperId: null, householdId: null}));
  const [{id: personId}] = await withFamily(familyId, (tx) => tx.select().from(people).where(and(eq(people.familyId, familyId), eq(people.displayName, "Member"))));
  const key = await withFamily(familyId, (tx) => issueKey(tx, manager, personId, "share", pepper, new Date()));
  const joined = (await withFamily(familyId, (tx) => redeemKey(tx, {familyId, value: key.token!, typed: false, pin, confirmation: pin, pepper, device: device(), currentViewer: null, now: new Date()}))).session!;
  return {familyId, viewer: (await resolve(joined.cookie))!, session: joined};
}

async function enroll(familyId: string, personId: string, enrollmentDevice: Device, viewer?: Viewer) {
  const id = secret();
  const {publicKey, privateKey} = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const jwk = publicKey.export({format: "jwk"});
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, "base64url"),
  ]);
  if (viewer) {
    const options = await registrationStart(viewer, enrollmentDevice);
    const clientData = Buffer.from(JSON.stringify({type: "webauthn.create", challenge: options!.challenge, origin}));
    const credentialId = Buffer.from(id, "base64url");
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(new URL(origin).hostname).digest(), Buffer.from([0x45]),
      Buffer.alloc(4 + 16), Buffer.from([0, credentialId.length]), credentialId, cose,
    ]);
    const attestation = Buffer.concat([
      Buffer.from([0xa3, 0x63]), Buffer.from("fmt"), Buffer.from([0x64]), Buffer.from("none"),
      Buffer.from([0x67]), Buffer.from("attStmt"), Buffer.from([0xa0, 0x68]), Buffer.from("authData"),
      Buffer.from([0x58, authenticatorData.length]), authenticatorData,
    ]);
    const response: RegistrationResponseJSON = {
      id, rawId: id, type: "public-key", clientExtensionResults: {},
      response: {clientDataJSON: clientData.toString("base64url"), attestationObject: attestation.toString("base64url")},
    };
    await expect(registrationFinish(viewer, enrollmentDevice, response)).resolves.toBe(true);
  } else {
    await withFamily(familyId, (tx) => tx.insert(passkeys).values({
      familyId, personId, id, deviceHash: enrollmentDevice.hash, publicKey: cose.toString("base64url"), counter: "0",
    }));
  }
  let counter = 0;
  return {
    id,
    authenticate: async (signInDevice: Device) => {
      cookieValues.clear();
      const options = await authenticationStart(signInDevice);
      const clientData = Buffer.from(JSON.stringify({type: "webauthn.get", challenge: options.challenge, origin}));
      const authenticatorData = Buffer.alloc(37);
      createHash("sha256").update(new URL(origin).hostname).digest().copy(authenticatorData);
      authenticatorData[32] = 0x05;
      authenticatorData.writeUInt32BE(++counter, 33);
      const payload = Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]);
      const response: AuthenticationResponseJSON = {
        id, rawId: id, type: "public-key", clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"),
          signature: sign("sha256", payload, privateKey).toString("base64url"),
          userHandle: Buffer.from((familyId + personId).replaceAll("-", ""), "hex").toString("base64url"),
        },
      };
      return authenticationFinish(signInDevice, response, null);
    },
  };
}

beforeEach(() => {
  cookieValues.clear();
  vi.stubEnv("AUTH_SECRET", pepper);
  vi.stubEnv("AUTH_ORIGIN", origin);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const familyId of cleanup) {
    await withFamily(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)));
  }
  cleanup.clear();
});

it("revokes the authenticating passkey after cookies change while preserving another credential", async () => {
  const {familyId, viewer} = await fixture();
  const enrollmentDevice = device();
  const suspect = await enroll(familyId, viewer.personId, enrollmentDevice);
  const unrelated = await enroll(familyId, viewer.personId, enrollmentDevice);
  const first = (await suspect.authenticate(device()))!.session;
  const second = (await suspect.authenticate(device()))!.session;
  const other = (await unrelated.authenticate(device()))!.session;
  const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, first.id)));
  expect(stored.deviceHash).not.toBe(enrollmentDevice.hash);
  expect(stored.passkeyId).toBe(suspect.id);
  const view = await withFamily(familyId, (tx) => account(tx, viewer));
  const event = view.activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === first.id)!;
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, event.id, new Date()))).resolves.toBe(true);
  for (const session of [first, second]) await expect(resolve(session.cookie)).resolves.toBeNull();
  await expect(resolve(other.cookie)).resolves.toMatchObject({personId: viewer.personId});
  await expect(suspect.authenticate(device())).resolves.toBeNull();
  await expect(unrelated.authenticate(device())).resolves.toHaveProperty("session");
  const credentials = await withFamily(familyId, (tx) => tx.select().from(passkeys));
  expect(credentials.find(({id}) => id === suspect.id)?.revokedAt).toBeInstanceOf(Date);
  expect(credentials.find(({id}) => id === unrelated.id)?.revokedAt).toBeNull();
});

it("preserves the owner's passkey and other sessions when an unrelated PIN session is reported", async () => {
  const {familyId, viewer, session: reporter} = await fixture();
  const credential = await enroll(familyId, viewer.personId, device());
  const first = (await credential.authenticate(device()))!.session;
  const second = (await credential.authenticate(device()))!.session;
  const reportedDevice = device();
  const suspect = (await withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, reportedDevice, new Date()))).session!;
  const [before] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, suspect.id)));
  expect(before.passkeyId).toBeNull();
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, suspect.id), eq(authEvents.kind, "newDevice"),
  )));
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, eventId, at))).resolves.toBe(true);
  await expect(resolve(suspect.cookie)).resolves.toBeNull();
  const [reported] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, suspect.id)));
  expect(reported).toMatchObject({revokedAt: at, trusted: false});
  await expect(withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, reportedDevice, new Date())))
    .resolves.toEqual({error: "newDevicesLocked"});
  for (const session of [reporter, first, second]) {
    await expect(resolve(session.cookie)).resolves.toMatchObject({personId: viewer.personId});
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: null, trusted: true});
  }
  const [storedCredential] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, credential.id)));
  expect(storedCredential.revokedAt).toBeNull();
  await expect(credential.authenticate(device())).resolves.toHaveProperty("session");
});

it("revokes a passkey enrolled on the reported browser and its sessions while preserving unrelated access", async () => {
  const {familyId, viewer} = await fixture();
  const originalDevice = device();
  const authenticating = await enroll(familyId, viewer.personId, originalDevice);
  const unrelated = await enroll(familyId, viewer.personId, originalDevice);
  const reportedDevice = device();
  const reported = (await authenticating.authenticate(reportedDevice))!.session;
  const reportedViewer = (await resolve(reported.cookie))!;
  const added = await enroll(familyId, viewer.personId, reportedDevice, reportedViewer);
  const remoteDevice = device();
  const remote = (await added.authenticate(remoteDevice))!.session;
  const reporter = (await authenticating.authenticate(device()))!.session;
  const reporterViewer = (await resolve(reporter.cookie))!;
  const other = (await unrelated.authenticate(device()))!.session;
  const view = await withFamily(familyId, (tx) => account(tx, reporterViewer));
  const event = view.activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === reported.id)!;
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, reporterViewer, event.id, at))).resolves.toBe(true);
  for (const session of [reported, remote]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: at, trusted: false});
  }
  for (const session of [reporter, other]) {
    await expect(resolve(session.cookie)).resolves.toMatchObject({personId: viewer.personId});
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: null, trusted: true});
  }
  for (const blockedDevice of [reportedDevice, remoteDevice]) {
    await expect(withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, blockedDevice, new Date())))
      .resolves.toEqual({error: "newDevicesLocked"});
  }
  await expect(authenticating.authenticate(device())).resolves.toBeNull();
  await expect(added.authenticate(device())).resolves.toBeNull();
  await expect(unrelated.authenticate(device())).resolves.toHaveProperty("session");
});

it("revokes existing passkey sessions after a PIN-authenticated enrollment browser is reported", async () => {
  const {familyId, viewer} = await fixture();
  const reportedDevice = device();
  const reported = (await withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, reportedDevice, new Date()))).session!;
  const reportedViewer = (await resolve(reported.cookie))!;
  const credential = await enroll(familyId, viewer.personId, reportedDevice, reportedViewer);
  const remoteDevice = device();
  const remote = (await credential.authenticate(remoteDevice))!.session;
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, reported.id), eq(authEvents.kind, "newDevice"),
  )));
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, eventId, at))).resolves.toBe(true);
  for (const session of [reported, remote]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: at, trusted: false});
  }
  const [reporter] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, viewer.sessionId)));
  expect(reporter).toMatchObject({revokedAt: null, trusted: true});
  await expect(credential.authenticate(device())).resolves.toBeNull();
  for (const blockedDevice of [reportedDevice, remoteDevice]) {
    await expect(withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, blockedDevice, new Date())))
      .resolves.toEqual({error: "newDevicesLocked"});
  }
});

it("revokes the full credential chain and a PIN successor linked through a retained revoked session", async () => {
  const {familyId, viewer, session: reporter} = await fixture();
  const enrollmentDevice = device();
  const firstCredential = await enroll(familyId, viewer.personId, enrollmentDevice);
  const unrelatedCredential = await enroll(familyId, viewer.personId, enrollmentDevice);
  const unrelatedSession = (await unrelatedCredential.authenticate(device()))!.session;
  const reportedDevice = device();
  const reported = (await firstCredential.authenticate(reportedDevice))!.session;
  const reportedViewer = (await resolve(reported.cookie))!;
  const secondCredential = await enroll(familyId, viewer.personId, reportedDevice, reportedViewer);
  const secondDevice = device();
  const intermediate = (await secondCredential.authenticate(secondDevice))!.session;
  const intermediateViewer = (await resolve(intermediate.cookie))!;
  const thirdCredential = await enroll(familyId, viewer.personId, secondDevice, intermediateViewer);
  const thirdDevice = device();
  const remote = (await thirdCredential.authenticate(thirdDevice))!.session;
  const pinSuccessor = (await withFamily(familyId, (tx) => signInWithPin(
    tx, familyId, viewer.personId, pin, pepper, secondDevice, new Date(),
  ))).session!;
  await expect(resolve(intermediate.cookie)).resolves.toBeNull();
  await expect(resolve(pinSuccessor.cookie)).resolves.toMatchObject({personId: viewer.personId});
  const [retained] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, intermediate.id)));
  expect(retained).toMatchObject({passkeyId: secondCredential.id, trusted: true});
  expect(retained.revokedAt).toBeInstanceOf(Date);
  const view = await withFamily(familyId, (tx) => account(tx, viewer));
  const event = view.activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === reported.id)!;
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, event.id, at))).resolves.toBe(true);
  for (const session of [reported, intermediate, pinSuccessor, remote]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: at, trusted: false});
  }
  for (const session of [reporter, unrelatedSession]) {
    await expect(resolve(session.cookie)).resolves.toMatchObject({personId: viewer.personId});
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: null, trusted: true});
  }
  for (const blockedDevice of [reportedDevice, secondDevice, thirdDevice]) {
    await expect(withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, blockedDevice, new Date())))
      .resolves.toEqual({error: "newDevicesLocked"});
  }
  for (const credential of [firstCredential, secondCredential, thirdCredential]) {
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, credential.id)));
    expect(stored.revokedAt).toEqual(at);
    await expect(credential.authenticate(device())).resolves.toBeNull();
  }
  await expect(unrelatedCredential.authenticate(device())).resolves.toHaveProperty("session");
});

it("keeps enrollment linked to its authorizing session when only the device cookie changes", async () => {
  const {familyId, viewer, session: reporter} = await fixture();
  const originalEnrollmentDevice = device();
  const firstCredential = await enroll(familyId, viewer.personId, originalEnrollmentDevice);
  const unrelatedCredential = await enroll(familyId, viewer.personId, originalEnrollmentDevice);
  const browserToken = secret();
  const reportedDevice = {...device(), hash: digest(browserToken)};
  const reported = (await firstCredential.authenticate(reportedDevice))!.session;
  await setSession(familyId, reported.cookie);
  cookieValues.set("__Host-fge-device", browserToken);
  await expect(requestDevice()).resolves.toMatchObject({hash: reportedDevice.hash});
  cookieValues.delete("__Host-fge-device");
  const enrollmentDevice = await requestDevice();
  expect(enrollmentDevice.hash).not.toBe(reportedDevice.hash);
  expect(cookieValues.get(sessionCookie)).toBe(reported.cookie);
  const authorizer = (await getViewer())!;
  expect(authorizer.sessionId).toBe(reported.id);
  const added = await enroll(familyId, viewer.personId, enrollmentDevice, authorizer);
  const [storedCredential] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, added.id)));
  expect(storedCredential.deviceHash).toBe(reportedDevice.hash);
  expect(storedCredential.deviceHash).not.toBe(enrollmentDevice.hash);
  const remote = (await added.authenticate(enrollmentDevice))!.session;
  const view = await withFamily(familyId, (tx) => account(tx, viewer));
  const event = view.activity.find(({kind, sessionId}) => kind === "newDevice" && sessionId === reported.id)!;
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, event.id, at))).resolves.toBe(true);
  for (const session of [reported, remote]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: at, trusted: false});
  }
  await expect(resolve(reporter.cookie)).resolves.toMatchObject({personId: viewer.personId});
  await expect(firstCredential.authenticate(device())).resolves.toBeNull();
  await expect(added.authenticate(device())).resolves.toBeNull();
  await expect(unrelatedCredential.authenticate(device())).resolves.toHaveProperty("session");
});

it("surfaces reset throttling after the previous requests have been answered", async () => {
  const {familyId, viewer} = await fixture(true);
  for (let i = 0; i < 3; i++) {
    await expect(forgotPin(familyId, viewer.personId)).resolves.toEqual({success: "resetRequested"});
  }
  const key = await withFamily(familyId, (tx) => issueKey(tx, viewer, viewer.personId, "reset", pepper, new Date()));
  const session = (await withFamily(familyId, (tx) => redeemKey(tx, {
    familyId, value: key.token!, typed: false, pin, confirmation: pin, pepper, device: device(), currentViewer: null, now: new Date(),
  }))).session!;
  const recovered = (await resolve(session.cookie))!;
  await expect(withFamily(familyId, (tx) => readiness(tx, recovered, new Date()))).resolves.toMatchObject({requests: []});
  await expect(forgotPin(familyId, viewer.personId)).resolves.toEqual({error: "tryLater"});
  await expect(withFamily(familyId, (tx) => readiness(tx, recovered, new Date()))).resolves.toMatchObject({requests: []});
});

it("keeps older member Face ID usable after lockdown while organizer recovery requires a new key", async () => {
  const {familyId, viewer, session: owner} = await fixture(true);
  const before = new Date(Date.now() - 3_600_000);
  await withFamily(familyId, async (tx) => {
    await tx.update(pinCredentials).set({changedAt: before}).where(eq(pinCredentials.familyId, familyId));
    await tx.update(sessions).set({createdAt: before}).where(eq(sessions.id, owner.id));
    await saveMember(tx, viewer, null, {name: "Member", language: "en", helperId: null, householdId: null});
  });
  const [{id: memberId}] = await withFamily(familyId, (tx) => tx.select().from(people).where(eq(people.displayName, "Member")));
  const key = await withFamily(familyId, (tx) => issueKey(tx, viewer, memberId, "share", pepper, before));
  const memberPhone = device();
  const member = (await withFamily(familyId, (tx) => redeemKey(tx, {
    familyId, value: key.token!, typed: false, pin, confirmation: pin, pepper, device: memberPhone, currentViewer: null, now: before,
  }))).session!;
  const memberCredential = await enroll(familyId, memberId, memberPhone, (await resolve(member.cookie))!);
  const ownerCredential = await enroll(familyId, viewer.personId, device());
  await withFamily(familyId, (tx) => tx.update(passkeys).set({enrolledAt: before}).where(eq(passkeys.familyId, familyId)));
  const intruder = (await withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, device(), new Date()))).session!;
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, intruder.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, eventId, new Date()))).resolves.toBe("lockdown");
  await expect(ownerCredential.authenticate(device())).resolves.toBeNull();
  const returned = (await memberCredential.authenticate(device()))!.session;
  await expect(resolve(returned.cookie)).resolves.toMatchObject({personId: memberId});
  const returnedViewer = (await resolve(returned.cookie))!;
  const activity = await withFamily(familyId, (tx) => account(tx, returnedViewer));
  expect(activity.activity.filter(({kind}) => kind === "familyLockdown")).toHaveLength(1);
});

it("revokes older authenticating passkeys in a co-organizer lockdown while preserving unrelated older Face ID", async () => {
  const {familyId, viewer, session: owner} = await fixture(true);
  const before = new Date(Date.now() - 3_600_000);
  await withFamily(familyId, (tx) => saveMember(tx, viewer, null, {name: "Co-organizer", language: "en", helperId: null, householdId: null}));
  const [{id: personId}] = await withFamily(familyId, (tx) => tx.select().from(people).where(eq(people.displayName, "Co-organizer")));
  const key = await withFamily(familyId, (tx) => issueKey(tx, viewer, personId, "share", pepper, before));
  const phone = device();
  const joined = (await withFamily(familyId, (tx) => redeemKey(tx, {
    familyId, value: key.token!, typed: false, pin, confirmation: pin, pepper, device: phone, currentViewer: null, now: before,
  }))).session!;
  await withFamily(familyId, (tx) => changeCoOrganizer(tx, viewer, personId, before));
  const reporter = (await resolve(joined.cookie))!;
  const authenticating = await enroll(familyId, personId, phone, reporter);
  const successorCredential = await enroll(familyId, personId, phone, reporter);
  const unrelated = await enroll(familyId, personId, phone, reporter);
  await withFamily(familyId, (tx) => tx.update(passkeys).set({enrolledAt: before}).where(eq(passkeys.personId, personId)));
  const reportedPhone = device();
  const reported = (await authenticating.authenticate(reportedPhone))!.session;
  const successor = (await successorCredential.authenticate(reportedPhone))!.session;
  const unrelatedSession = (await unrelated.authenticate(device()))!.session;
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, reported.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, reporter, eventId, new Date()))).resolves.toBe("lockdown");
  for (const session of [owner, joined, reported, successor, unrelatedSession]) await expect(resolve(session.cookie)).resolves.toBeNull();
  for (const credential of [authenticating, successorCredential]) {
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, credential.id)));
    expect(stored.enrolledAt).toEqual(before);
    expect(stored.revokedAt).toBeInstanceOf(Date);
    await expect(credential.authenticate(device())).resolves.toBeNull();
  }
  const [preserved] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, unrelated.id)));
  expect(preserved.revokedAt).toBeNull();
  const returned = (await unrelated.authenticate(device()))!.session;
  await expect(resolve(returned.cookie)).resolves.toMatchObject({personId, isOrganizer: true});
});

it("does not expand revocation through a passkey's earlier browser while revoking later PIN successors", async () => {
  const {familyId, viewer, session: reporter} = await fixture();
  const earlierPhone = device();
  const authenticating = await enroll(familyId, viewer.personId, earlierPhone);
  const unrelated = await enroll(familyId, viewer.personId, earlierPhone);
  const historical = (await authenticating.authenticate(earlierPhone))!.session;
  const other = (await unrelated.authenticate(device()))!.session;
  const before = new Date(Date.now() - 60_000);
  await withFamily(familyId, async (tx) => {
    await tx.update(passkeys).set({enrolledAt: before}).where(eq(passkeys.personId, viewer.personId));
    await tx.update(sessions).set({createdAt: before}).where(and(
      eq(sessions.personId, viewer.personId), eq(sessions.id, historical.id),
    ));
  });
  const reportedPhone = device();
  const reported = (await authenticating.authenticate(reportedPhone))!.session;
  const successorPhone = device();
  const bridge = (await authenticating.authenticate(successorPhone))!.session;
  const successor = (await withFamily(familyId, (tx) => signInWithPin(
    tx, familyId, viewer.personId, pin, pepper, successorPhone, new Date(),
  ))).session!;
  await expect(resolve(bridge.cookie)).resolves.toBeNull();
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, reported.id), eq(authEvents.kind, "newDevice"),
  )));
  const at = new Date();
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, eventId, at))).resolves.toBe(true);
  for (const session of [reported, bridge, successor]) {
    await expect(resolve(session.cookie)).resolves.toBeNull();
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: at, trusted: false});
  }
  for (const session of [reporter, historical, other]) {
    await expect(resolve(session.cookie)).resolves.toMatchObject({personId: viewer.personId});
    const [stored] = await withFamily(familyId, (tx) => tx.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(stored).toMatchObject({revokedAt: null, trusted: true});
  }
  for (const phone of [reportedPhone, successorPhone]) {
    await expect(withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, phone, new Date())))
      .resolves.toEqual({error: "newDevicesLocked"});
  }
  await expect(authenticating.authenticate(device())).resolves.toBeNull();
  const [preserved] = await withFamily(familyId, (tx) => tx.select().from(passkeys).where(eq(passkeys.id, unrelated.id)));
  expect(preserved.revokedAt).toBeNull();
  const returned = (await unrelated.authenticate(device()))!.session;
  await expect(resolve(returned.cookie)).resolves.toMatchObject({personId: viewer.personId});
});
