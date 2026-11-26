import "server-only";
import {and, eq, isNull, lt} from "drizzle-orm";
import {cookies} from "next/headers";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {withFamily} from "../db/client";
import {activePerson, clearAttempts, lockFamily, signInDevice, type Device} from "./access";
import type {Viewer} from "./index";
import {authLimits, passkeys, pinCredentials} from "./schema";
import {appOrigin, privateCookie} from "./request";
import {authenticatorSecret, clearedAttempts, hashPin, keyedHash, pinProblem} from "./pin";
import {digest, equalDigests, revalidateViewer, uuidPattern} from "./session";

const challengeCookie = "__Host-fge-ceremony";
const changePinCookie = "__Host-fge-change-pin";
const challengeMs = 5 * 60_000;

function signed(payload: string, purpose: string) {
  return keyedHash(authenticatorSecret(), purpose, payload);
}

function pack(subject: string, challenge: string, device: Device, purpose: string) {
  const body = `${Date.now() + challengeMs}.${device.hash}.${subject}.${challenge}`;
  return `${body}.${signed(body, purpose)}`;
}

function unpack(value: string, device: Device, subject: string, purpose: string) {
  const [expiry, hash, who, challenge, signature, extra] = value.split(".");
  if (extra !== undefined || !expiry || !challenge || !signature || !/^[0-9a-f]{64}$/.test(signature)
    || Number(expiry) <= Date.now() || hash !== device.hash || who !== subject) return null;
  const body = `${expiry}.${hash}.${who}.${challenge}`;
  return equalDigests(signature, signed(body, purpose)) ? challenge : null;
}

async function saveChallenge(challenge: string, device: Device, subject: string) {
  (await cookies()).set(challengeCookie, pack(subject, challenge, device, "webauthn"), {
    ...privateCookie, maxAge: challengeMs / 1000,
  });
}

async function takeChallenge(device: Device, subject: string) {
  const jar = await cookies();
  const saved = jar.get(challengeCookie)?.value ?? "";
  jar.set(challengeCookie, "", {...privateCookie, maxAge: 0});
  return unpack(saved, device, subject, "webauthn");
}

function userHandle(familyId: string, personId: string) {
  return Buffer.from((familyId + personId).replaceAll("-", ""), "hex");
}

function userIds(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url").toString("hex");
  const format = (hex: string) => [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  const familyId = format(bytes.slice(0, 32));
  const personId = format(bytes.slice(32));
  return uuidPattern.test(familyId) && uuidPattern.test(personId) ? {familyId, personId} : null;
}

export async function registrationStart(viewer: Viewer, device: Device) {
  const person = await withFamily(viewer.familyId, (tx) => activePerson(tx, viewer.familyId, viewer.personId));
  if (!person || person.helperId) return null;
  const options = await generateRegistrationOptions({
    rpName: "Family Gift Exchange",
    rpID: appOrigin().hostname,
    userID: userHandle(viewer.familyId, viewer.personId),
    userName: person.displayName,
    userDisplayName: person.displayName,
    attestationType: "none",
    authenticatorSelection: {residentKey: "required", userVerification: "required", authenticatorAttachment: "platform"},
  });
  await saveChallenge(options.challenge, device, viewer.sessionId);
  return options;
}

export async function registrationFinish(viewer: Viewer, device: Device, response: RegistrationResponseJSON) {
  const challenge = await takeChallenge(device, viewer.sessionId);
  if (!challenge) return false;
  const origin = appOrigin();
  const result = await verifyRegistrationResponse({
    response, expectedChallenge: challenge, expectedOrigin: origin.origin,
    expectedRPID: origin.hostname, requireUserVerification: true,
  });
  if (!result.verified) return false;
  const {credential} = result.registrationInfo;
  const {familyId, personId} = viewer;
  return withFamily(familyId, async (tx) => {
    await lockFamily(tx, familyId);
    const session = await revalidateViewer(tx, viewer);
    if (!session) return false;
    const [inserted] = await tx.insert(passkeys).values({
      familyId, personId, deviceHash: session.deviceHash, id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: String(credential.counter),
    }).onConflictDoNothing().returning({id: passkeys.id});
    return Boolean(inserted);
  });
}

export async function authenticationStart(device: Device) {
  const options = await generateAuthenticationOptions({rpID: appOrigin().hostname, userVerification: "required"});
  await saveChallenge(options.challenge, device, "sign-in");
  return options;
}

export async function authenticationFinish(device: Device, response: AuthenticationResponseJSON, current: Viewer | null) {
  const challenge = await takeChallenge(device, "sign-in");
  const ids = userIds(response?.response?.userHandle);
  if (!challenge || !ids || (current && (current.personId !== ids.personId || current.familyId !== ids.familyId))) return null;
  const {familyId, personId} = ids;
  const origin = appOrigin();
  const session = await withFamily(familyId, async (tx) => {
    if (!await lockFamily(tx, familyId)) return null;
    const person = await activePerson(tx, familyId, personId);
    if (!person || person.helperId || !response.id) return null;
    const [stored] = await tx.select().from(passkeys).where(and(
      eq(passkeys.familyId, familyId), eq(passkeys.personId, personId), eq(passkeys.id, response.id), isNull(passkeys.revokedAt),
    ));
    if (!stored) return null;
    const result = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin.origin, expectedRPID: origin.hostname,
      requireUserVerification: true,
      credential: {id: stored.id, publicKey: Buffer.from(stored.publicKey, "base64url"), counter: Number(stored.counter)},
    });
    if (!result.verified) return null;
    // Some authenticators always return a zero counter. Consume each signed challenge once even for these.
    const now = new Date();
    await tx.delete(authLimits).where(and(eq(authLimits.familyId, familyId),
      lt(authLimits.windowStartedAt, new Date(now.getTime() - 24 * 60 * 60_000))));
    const [use] = await tx.insert(authLimits).values({
      familyId, bucket: `passkey:${digest(challenge)}`, windowStartedAt: now, count: 1,
    }).onConflictDoNothing().returning({bucket: authLimits.bucket});
    if (!use) return null;
    await tx.update(passkeys).set({counter: String(result.authenticationInfo.newCounter)})
      .where(and(eq(passkeys.familyId, familyId), eq(passkeys.id, stored.id)));
    await clearAttempts(tx, familyId, personId);
    return signInDevice(tx, familyId, personId, device, now, stored.id);
  });
  if (!session) return null;
  (await cookies()).set(changePinCookie, pack(session.id, "verified", device, "change-pin"), {
    ...privateCookie, maxAge: challengeMs / 1000,
  });
  return {familyId, session};
}

export async function changePinAfterFaceId(viewer: Viewer, device: Device, pin: string, confirmation: string) {
  const problem = pinProblem(pin, confirmation);
  if (problem) return problem;
  const jar = await cookies();
  if (!unpack(jar.get(changePinCookie)?.value ?? "", device, viewer.sessionId, "change-pin")) return "faceAgain";
  const {familyId, personId, sessionId} = viewer;
  return withFamily(familyId, async (tx) => {
    await lockFamily(tx, familyId);
    if (!await revalidateViewer(tx, viewer)) return "faceAgain";
    const now = new Date();
    const [use] = await tx.insert(authLimits).values({
      familyId, bucket: `pin-change:${sessionId}`, windowStartedAt: now, count: 1,
    }).onConflictDoNothing().returning({bucket: authLimits.bucket});
    if (!use) return "faceAgain";
    await tx.update(pinCredentials).set({pinHash: await hashPin(authenticatorSecret(), pin), ...clearedAttempts})
      .where(and(eq(pinCredentials.familyId, familyId), eq(pinCredentials.personId, personId)));
    jar.set(changePinCookie, "", {...privateCookie, maxAge: 0});
    return null;
  });
}
