import {randomInt, randomUUID} from "node:crypto";
import {and, count, eq, gt, isNull, ne} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {families, people, participants} from "../db/schema";
import type {Viewer} from "./index";
import {authEvents, authLimits, passkeys, personalKeys, pinCredentials, pinResetRequests, sessions} from "./schema";
import {createSession, digest, revalidateViewer, secret, seasonSeconds, uuidPattern} from "./session";
import {clearedAttempts, day, failedAttempt, hashPin, keyedHash, pinProblem, verifyPin} from "./pin";

export type DeviceKind = "iphone" | "ipad" | "android" | "computer" | "other";
export type Device = {hash: string; kind: DeviceKind; network: string | null};
export type KeyKind = typeof personalKeys.$inferInsert.kind;
export const codeAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const keyCodePattern = new RegExp(`^[${codeAlphabet}]{6}$`);
export const keyTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function makeCode() {
  return Array.from({length: 6}, () => codeAlphabet[randomInt(codeAlphabet.length)]).join("");
}

export function parseLinkKey(value: string) {
  const [familyId, token, extra] = value.split("~");
  return extra === undefined && uuidPattern.test(familyId) && keyTokenPattern.test(token ?? "")
    ? {familyId, token} : null;
}

export async function lockFamily(tx: FamilyTransaction, familyId: string) {
  const [family] = await tx.select({id: families.id}).from(families).where(eq(families.id, familyId)).for("update");
  return Boolean(family);
}

export async function activePerson(tx: FamilyTransaction, familyId: string, personId: string) {
  const [person] = await tx.select().from(people).where(and(
    eq(people.familyId, familyId), eq(people.id, personId), isNull(people.removedAt),
  ));
  return person;
}

export async function isManager(tx: FamilyTransaction, viewer: Viewer) {
  const current = await revalidateViewer(tx, viewer);
  return Boolean(current?.isOrganizer && current.actingAs === current.personId);
}

const credentialFor = (familyId: string, personId: string) =>
  and(eq(pinCredentials.familyId, familyId), eq(pinCredentials.personId, personId));

async function credential(tx: FamilyTransaction, familyId: string, personId: string) {
  const [row] = await tx.select().from(pinCredentials).where(credentialFor(familyId, personId));
  return row;
}

export async function clearAttempts(tx: FamilyTransaction, familyId: string, personId: string) {
  await tx.update(pinCredentials).set(clearedAttempts).where(credentialFor(familyId, personId));
}

async function throttle(tx: FamilyTransaction, familyId: string, name: string, maximum: number, window: number, now: Date) {
  const [row] = await tx.select().from(authLimits).where(and(eq(authLimits.familyId, familyId), eq(authLimits.bucket, name)));
  const current = row && now.getTime() - row.windowStartedAt.getTime() < window;
  if (current && row.count >= maximum) return false;
  const values = {count: current ? row.count + 1 : 1, windowStartedAt: current ? row.windowStartedAt : now};
  await tx.insert(authLimits).values({familyId, bucket: name, ...values})
    .onConflictDoUpdate({target: [authLimits.familyId, authLimits.bucket], set: values});
  return true;
}

export async function allowCodeTry(tx: FamilyTransaction, familyId: string, device: Device, now: Date) {
  // Six characters need a database-backed ceiling even when a browser changes cookies.
  if (device.network && !await throttle(tx, familyId, `code:${device.network}`, 12, 60 * 60_000, now)) return false;
  return throttle(tx, familyId, "code", 120, 60 * 60_000, now);
}

export async function lookupKey(tx: FamilyTransaction, familyId: string, pepper: string, value: string, typed = false) {
  const hash = typed ? keyedHash(pepper, "key-code", `${familyId}.${value}`) : digest(value);
  const [row] = await tx.select().from(personalKeys).where(and(
    eq(personalKeys.familyId, familyId), eq(typed ? personalKeys.codeHash : personalKeys.tokenHash, hash),
  ));
  return row;
}

export async function inspectKey(tx: FamilyTransaction, familyId: string, token: string, now: Date, pepper?: string) {
  const key = await lookupKey(tx, familyId, pepper ?? "", token, Boolean(pepper));
  if (!key) return null;
  const person = await activePerson(tx, familyId, key.personId);
  if (!person || person.helperId) return null;
  const [family] = await tx.select({name: families.name}).from(families).where(eq(families.id, familyId));
  const [usedDevice] = key.usedSessionId ? await tx.select({kind: sessions.deviceKind}).from(sessions)
    .where(and(eq(sessions.familyId, familyId), eq(sessions.id, key.usedSessionId))) : [];
  return {
    personId: person.id, name: person.displayName, familyName: family.name,
    usedAt: key.usedAt, usedDevice: usedDevice?.kind,
    available: !key.revokedAt && !key.usedAt && key.expiresAt > now,
  };
}

export async function issueKey(
  tx: FamilyTransaction, viewer: Viewer, personId: string, kind: KeyKind, pepper: string, now: Date,
) {
  const {familyId} = viewer;
  await lockFamily(tx, familyId);
  if (!await isManager(tx, viewer)) return {error: "forbidden"} as const;
  const person = await activePerson(tx, familyId, personId);
  if (!person || person.helperId || (viewer.personId === personId && kind !== "reset")) return {error: "unavailable"} as const;
  return prepareKey(tx, familyId, person, viewer.personId, kind, pepper, now);
}

export async function issueOrganizerKey(tx: FamilyTransaction, familyId: string, pepper: string, now: Date) {
  if (!await lockFamily(tx, familyId)) return {error: "unavailable"} as const;
  const [organizer] = await tx.select().from(people).where(and(
    eq(people.familyId, familyId), isNull(people.removedAt), eq(people.role, "organizer"),
  ));
  if (!organizer || organizer.helperId) return {error: "unavailable"} as const;
  return prepareKey(tx, familyId, organizer, organizer.id, "reset", pepper, now);
}

async function prepareKey(
  tx: FamilyTransaction, familyId: string, person: typeof people.$inferSelect, issuedBy: string,
  kind: KeyKind, pepper: string, now: Date,
) {
  const personId = person.id;
  const joined = await credential(tx, familyId, personId);
  if (Boolean(joined) !== (kind === "reset")) return {error: "unavailable"} as const;

  const [request] = kind === "reset" ? await tx.select({id: pinResetRequests.id}).from(pinResetRequests)
    .where(and(eq(pinResetRequests.familyId, familyId), eq(pinResetRequests.personId, personId),
      isNull(pinResetRequests.answeredAt))).limit(1) : [];
  const id = randomUUID();
  const token = secret();
  const ttl = kind === "qr" ? 10 * 60_000 : kind === "reset" ? 7 * day : seasonSeconds * 1000;
  const expiresAt = new Date(now.getTime() + ttl);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const [inserted] = await tx.insert(personalKeys).values({
      familyId, id, personId, issuedBy, tokenHash: digest(token),
      codeHash: keyedHash(pepper, "key-code", `${familyId}.${code}`), kind, createdAt: now, expiresAt,
    }).onConflictDoNothing().returning({id: personalKeys.id});
    if (!inserted) continue;
    if (kind === "reset") {
      await tx.update(personalKeys).set({revokedAt: now}).where(and(
        eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId),
        eq(personalKeys.kind, "reset"), isNull(personalKeys.usedAt), isNull(personalKeys.revokedAt),
        ne(personalKeys.id, id),
      ));
    }
    const event = kind === "reset" ? (request ? "resetPrepared" : "resetPreparedWithoutRequest") : "keyPrepared";
    await tx.insert(authEvents).values({familyId, personId, keyId: id, kind: event, at: now});
    return {id, token, code, name: person.displayName, language: person.language, expiresAt};
  }
  throw new Error("Could not allocate a unique key code");
}

export async function markKeySent(tx: FamilyTransaction, viewer: Viewer, keyId: string, now: Date) {
  await lockFamily(tx, viewer.familyId);
  if (!await isManager(tx, viewer)) return false;
  const [key] = await tx.update(personalKeys).set({sentAt: now}).where(and(
    eq(personalKeys.familyId, viewer.familyId), eq(personalKeys.id, keyId), eq(personalKeys.issuedBy, viewer.personId),
    isNull(personalKeys.sentAt), isNull(personalKeys.revokedAt),
  )).returning({personId: personalKeys.personId, kind: personalKeys.kind});
  if (!key) return false;
  const {familyId} = viewer;
  await tx.insert(authEvents).values({
    familyId, personId: key.personId, keyId, kind: key.kind === "reset" ? "resetSent" : "keySent", at: now,
  });
  return true;
}

export async function disputeUsedKey(
  tx: FamilyTransaction, familyId: string, value: string, typed: boolean, pepper: string, device: Device, now: Date,
) {
  if (!(typed ? keyCodePattern : keyTokenPattern).test(value)) return {error: "unavailable"} as const;
  if (!await lockFamily(tx, familyId)) return {error: "unavailable"} as const;
  if (typed && !await allowCodeTry(tx, familyId, device, now)) return {error: "tryLater"} as const;
  const key = await lookupKey(tx, familyId, pepper, value, typed);
  if (!key?.usedAt) return {error: "unavailable"} as const;
  const person = await activePerson(tx, familyId, key.personId);
  if (!person || person.helperId) return {error: "unavailable"} as const;
  const [existing] = await tx.select({id: authEvents.id}).from(authEvents).where(and(
    eq(authEvents.familyId, familyId), eq(authEvents.keyId, key.id), eq(authEvents.kind, "keyDisputed"),
  )).limit(1);
  if (!existing) await tx.insert(authEvents).values({
    familyId, personId: key.personId, keyId: key.id, sessionId: key.usedSessionId,
    kind: "keyDisputed", deviceKind: device.kind, at: now,
  });
  return {success: "keyDisputed"} as const;
}

export async function signInDevice(
  tx: FamilyTransaction, familyId: string, personId: string, device: Device, now: Date, passkeyId: string | null = null,
) {
  const remembered = await isTrustedDevice(tx, familyId, personId, device.hash, now);
  await tx.update(sessions).set({revokedAt: now}).where(and(
    eq(sessions.familyId, familyId), eq(sessions.personId, personId), eq(sessions.deviceHash, device.hash),
    isNull(sessions.revokedAt),
  ));
  const session = await createSession(tx, familyId, personId, device.hash, device.kind, now, passkeyId);
  if (!remembered) await tx.insert(authEvents).values({
    familyId, personId, sessionId: session.id, kind: "newDevice", deviceKind: device.kind, at: now,
  });
  return session;
}

async function isTrustedDevice(tx: FamilyTransaction, familyId: string, personId: string, hash: string, now: Date) {
  const [row] = await tx.select({id: sessions.id}).from(sessions).where(and(
    eq(sessions.familyId, familyId), eq(sessions.personId, personId), eq(sessions.deviceHash, hash),
    eq(sessions.trusted, true), gt(sessions.expiresAt, now),
  )).limit(1);
  return Boolean(row);
}

export async function redeemKey(
  tx: FamilyTransaction, input: {
    familyId: string; value: string; typed: boolean; pepper: string; pin: string; confirmation: string;
    device: Device; currentViewer: Viewer | null; now: Date;
  },
) {
  const {familyId, value, typed, pepper, pin, confirmation, device, currentViewer, now} = input;
  const problem = pinProblem(pin, confirmation);
  if (problem) return {error: problem};
  if (!await lockFamily(tx, familyId)) return {error: "unavailable"} as const;
  if (typed) {
    if (!keyCodePattern.test(value)) return {error: "unavailable"} as const;
    if (!await allowCodeTry(tx, familyId, device, now)) return {error: "tryLater"} as const;
  } else if (!keyTokenPattern.test(value)) {
    return {error: "unavailable"} as const;
  }
  const key = await lookupKey(tx, familyId, pepper, value, typed);
  if (!key || key.revokedAt || key.expiresAt <= now) return {error: "unavailable"} as const;
  const person = await activePerson(tx, familyId, key.personId);
  if (!person || person.helperId) return {error: "unavailable"} as const;
  if (currentViewer && (currentViewer.familyId !== familyId || currentViewer.personId !== person.id)) {
    return {error: "otherPerson"} as const;
  }
  if (key.usedAt) return {error: "usedKey"} as const;
  const previous = await credential(tx, familyId, person.id);
  if (Boolean(previous) !== (key.kind === "reset")) return {error: "unavailable"} as const;

  const pinHash = await hashPin(pepper, pin);
  await tx.insert(pinCredentials).values({familyId, personId: person.id, pinHash, joinedAt: now})
    .onConflictDoUpdate({target: [pinCredentials.familyId, pinCredentials.personId], set: {pinHash, ...clearedAttempts}});
  if (key.kind === "reset") {
    await tx.update(sessions).set({revokedAt: now, trusted: false}).where(and(
      eq(sessions.familyId, familyId), eq(sessions.personId, person.id),
    ));
    await tx.update(passkeys).set({revokedAt: now}).where(and(
      eq(passkeys.familyId, familyId), eq(passkeys.personId, person.id),
    ));
  }
  const session = await signInDevice(tx, familyId, person.id, device, now);
  await tx.update(personalKeys).set({usedAt: now, usedSessionId: session.id}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.id, key.id),
  ));
  await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.personId, person.id),
    isNull(personalKeys.usedAt), isNull(personalKeys.revokedAt),
  ));
  await tx.update(participants).set({joinedAt: now}).where(and(
    eq(participants.familyId, familyId), eq(participants.personId, person.id), isNull(participants.joinedAt),
  ));
  if (key.kind === "reset") await answerResetRequests(tx, familyId, person.id, now);
  await tx.insert(authEvents).values({
    familyId, personId: person.id, keyId: key.id, sessionId: session.id,
    kind: key.kind === "reset" ? "resetUsed" : "keyUsed", deviceKind: device.kind, at: now,
  });
  return {session};
}

export async function signInWithPin(
  tx: FamilyTransaction, familyId: string, personId: string, pin: string, pepper: string,
  device: Device, now: Date,
) {
  if (!/^[0-9]{4}$/.test(pin) || !await lockFamily(tx, familyId)) return {error: "invalidPin"} as const;
  const person = await activePerson(tx, familyId, personId);
  const row = person && !person.helperId ? await credential(tx, familyId, person.id) : null;
  if (!row) return {error: "invalidPin"} as const;
  if (row.lockedUntil && row.lockedUntil > now) return {error: "pinLocked"} as const;
  const trusted = await isTrustedDevice(tx, familyId, personId, device.hash, now);
  if (row.newDevicesLocked && !trusted) return {error: "newDevicesLocked"} as const;
  if (device.network && !await throttle(tx, familyId, `pin:${device.network}`, 60, 15 * 60_000, now)) {
    return {error: "tryLater"} as const;
  }
  if (!await verifyPin(pepper, pin, row.pinHash)) {
    const result = failedAttempt(row, now);
    await tx.update(pinCredentials).set(result).where(credentialFor(familyId, personId));
    if (!row.newDevicesLocked && result.newDevicesLocked) {
      await tx.insert(authEvents).values({familyId, personId, kind: "newDevicesLocked", deviceKind: device.kind, at: now});
      return {error: "newDevicesLocked"} as const;
    }
    if (result.lockedUntil) {
      await tx.insert(authEvents).values({familyId, personId, kind: "pinLocked", deviceKind: device.kind, at: now});
      return {error: "pinLocked"} as const;
    }
    return {error: "invalidPin"} as const;
  }
  if (trusted) await clearAttempts(tx, familyId, personId);
  return {session: await signInDevice(tx, familyId, personId, device, now)};
}

export async function requestPinReset(
  tx: FamilyTransaction, familyId: string, personId: string, device: Device, now: Date,
) {
  if (!await lockFamily(tx, familyId)) return {error: "unavailable"} as const;
  const person = await activePerson(tx, familyId, personId);
  if (!person || person.helperId || !await credential(tx, familyId, personId)) return {error: "unavailable"} as const;
  const [recent] = await tx.select({total: count()}).from(pinResetRequests).where(and(
    eq(pinResetRequests.familyId, familyId), eq(pinResetRequests.personId, personId),
    gt(pinResetRequests.requestedAt, new Date(now.getTime() - day)),
  ));
  if (recent.total >= 3) return {error: "tryLater"} as const;
  await tx.insert(pinResetRequests).values({familyId, personId, deviceKind: device.kind, requestedAt: now});
  return {success: "resetRequested"} as const;
}

async function answerResetRequests(tx: FamilyTransaction, familyId: string, personId: string, now: Date) {
  await tx.update(pinResetRequests).set({answeredAt: now}).where(and(
    eq(pinResetRequests.familyId, familyId), eq(pinResetRequests.personId, personId), isNull(pinResetRequests.answeredAt),
  ));
}
