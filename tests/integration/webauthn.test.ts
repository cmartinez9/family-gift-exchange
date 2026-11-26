import {createHash, generateKeyPairSync, randomUUID, sign} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import {withFamily} from "../../src/server/db/client";
import {families} from "../../src/server/db/schema";
import {createFamily, readiness} from "../../src/server/auth/families";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {authEvents, passkeys, sessions} from "../../src/server/auth/schema";
import {account, disputeEvent} from "../../src/server/auth/security";
import {issueKey, redeemKey, signInWithPin, type Device} from "../../src/server/auth/access";
import {authenticationFinish, authenticationStart} from "../../src/server/auth/webauthn";
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

async function fixture() {
  const familyId = randomUUID();
  const session = await withFamily(familyId, (tx) => createFamily(tx, {
    familyId, familyName: "Passkey fixture", displayName: "Northstar", language: "en", pin, pepper,
    device: device(), now: new Date(),
  }));
  cleanup.add(familyId);
  const viewer = (await resolve(session.cookie))!;
  return {familyId, viewer};
}

async function enroll(familyId: string, personId: string, enrollmentDevice: Device) {
  const id = secret();
  const {publicKey, privateKey} = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const jwk = publicKey.export({format: "jwk"});
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, "base64url"),
  ]);
  await withFamily(familyId, (tx) => tx.insert(passkeys).values({
    familyId, personId, id, deviceHash: enrollmentDevice.hash, publicKey: cose.toString("base64url"), counter: "0",
  }));
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

it("revokes credentials conservatively when a disputed session has no recorded passkey", async () => {
  const {familyId, viewer} = await fixture();
  const credential = await enroll(familyId, viewer.personId, device());
  const suspect = (await withFamily(familyId, (tx) => signInWithPin(tx, familyId, viewer.personId, pin, pepper, device(), new Date()))).session!;
  const [{id: eventId}] = await withFamily(familyId, (tx) => tx.select().from(authEvents).where(and(
    eq(authEvents.sessionId, suspect.id), eq(authEvents.kind, "newDevice"),
  )));
  await expect(withFamily(familyId, (tx) => disputeEvent(tx, viewer, eventId, new Date()))).resolves.toBe(true);
  await expect(credential.authenticate(device())).resolves.toBeNull();
});

it("surfaces reset throttling after the previous requests have been answered", async () => {
  const {familyId, viewer} = await fixture();
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
