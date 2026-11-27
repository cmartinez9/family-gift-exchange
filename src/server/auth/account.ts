import {and, count, desc, eq, gt, inArray, isNull} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {families, items, people, sizes} from "../db/schema";
import type {Viewer} from "./index";
import {authEvents, passkeys, personalKeys, pinCredentials, sessions} from "./schema";

/**
 * Read-only projections for the sign-in, onboarding and account screens. Each one returns only what
 * its screen shows, and never anything about the draw.
 */

const MAX_TRIES = 5;

export async function organizerContacts(tx: FamilyTransaction, familyId: string) {
  return tx.select({personId: people.id, name: people.displayName, language: people.language}).from(people).where(and(
    eq(people.familyId, familyId), inArray(people.role, ["organizer", "co_organizer"]),
    isNull(people.removedAt), isNull(people.helperId),
  )).orderBy(desc(eq(people.role, "organizer")), people.id);
}

/** What a PIN screen may say after a refusal: tries left before the 15-minute rest, or minutes left in it. */
export async function pinAttemptState(tx: FamilyTransaction, familyId: string, personId: string, now: Date) {
  const [row] = await tx.select({
    failedInWindow: pinCredentials.failedInWindow, lockedUntil: pinCredentials.lockedUntil,
    windowStartedAt: pinCredentials.windowStartedAt,
  }).from(pinCredentials).where(and(eq(pinCredentials.familyId, familyId), eq(pinCredentials.personId, personId)));
  if (!row) return null;
  if (row.lockedUntil && row.lockedUntil > now) {
    return {triesLeft: 0, minutes: Math.max(1, Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000))};
  }
  return {triesLeft: Math.max(0, MAX_TRIES - row.failedInWindow), minutes: 0};
}

/** The organizer's first name: the person every "ask for help" line names. */
export async function organizerName(tx: FamilyTransaction, familyId: string) {
  const [organizer] = await tx.select({name: people.displayName}).from(people).where(and(
    eq(people.familyId, familyId), eq(people.role, "organizer"), isNull(people.removedAt),
  )).limit(1);
  return organizer?.name ?? null;
}

/** Who prepared a key, for "Christian sent you this key". */
export async function keySender(tx: FamilyTransaction, familyId: string, keyId: string) {
  const [row] = await tx.select({name: people.displayName}).from(personalKeys)
    .innerJoin(people, and(eq(people.familyId, personalKeys.familyId), eq(people.id, personalKeys.issuedBy)))
    .where(and(eq(personalKeys.familyId, familyId), eq(personalKeys.id, keyId)));
  return row?.name ?? null;
}

/**
 * The people who have signed in with this browser before, newest first: the welcome back greeting
 * names the only one, and a shared iPad lists them.
 */
export async function peopleOnDevice(tx: FamilyTransaction, familyId: string, deviceHash: string) {
  const rows = await tx.select({personId: sessions.personId, at: sessions.createdAt}).from(sessions)
    .innerJoin(people, and(eq(people.familyId, sessions.familyId), eq(people.id, sessions.personId)))
    .where(and(eq(sessions.familyId, familyId), eq(sessions.deviceHash, deviceHash), isNull(people.removedAt)))
    .orderBy(desc(sessions.createdAt));
  return [...new Set(rows.map(({personId}) => personId))];
}

/** The phones and tablets signed in as this person right now, the current one first. */
export async function signedInDevices(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  const rows = await tx.select({
    id: sessions.id, kind: sessions.deviceKind, at: sessions.createdAt, passkeyId: sessions.passkeyId,
    deviceHash: sessions.deviceHash,
  }).from(sessions).where(and(
    eq(sessions.familyId, viewer.familyId), eq(sessions.personId, viewer.personId),
    isNull(sessions.revokedAt), gt(sessions.expiresAt, now),
  )).orderBy(desc(sessions.createdAt));
  const faces = await tx.select({id: passkeys.id, deviceHash: passkeys.deviceHash}).from(passkeys).where(and(
    eq(passkeys.familyId, viewer.familyId), eq(passkeys.personId, viewer.personId), isNull(passkeys.revokedAt),
  ));
  const withFace = new Set(faces.map(({deviceHash}) => deviceHash));
  const faceIds = new Set(faces.map(({id}) => id));
  return rows
    .map(({id, kind, at, deviceHash, passkeyId}) => ({
      id, kind, at, current: id === viewer.sessionId,
      faceId: withFace.has(deviceHash) || (passkeyId !== null && faceIds.has(passkeyId)),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** What the "You" screen summarises. */
export async function youSummary(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  const {familyId, personId} = viewer;
  const [family] = await tx.select({name: families.name}).from(families).where(eq(families.id, familyId));
  const [person] = await tx.select({noClothes: people.noClothes}).from(people)
    .where(and(eq(people.familyId, familyId), eq(people.id, personId)));
  const mySizes = await tx.select({kind: sizes.kind, value: sizes.value}).from(sizes)
    .where(and(eq(sizes.familyId, familyId), eq(sizes.personId, personId)));
  const devices = await signedInDevices(tx, viewer, now);
  return {
    familyName: family?.name ?? "",
    noClothes: person?.noClothes ?? false,
    sizes: Object.fromEntries(mySizes.map(({kind, value}) => [kind, value])) as Record<string, string>,
    devices: devices.length,
    faceId: devices.find(({current}) => current)?.faceId ?? false,
  };
}

/** Sizes and "No clothes, please", for onboarding's sizes step. */
export async function mySizes(tx: FamilyTransaction, familyId: string, personId: string) {
  const [person] = await tx.select({noClothes: people.noClothes}).from(people)
    .where(and(eq(people.familyId, familyId), eq(people.id, personId)));
  const rows = await tx.select({kind: sizes.kind, value: sizes.value}).from(sizes)
    .where(and(eq(sizes.familyId, familyId), eq(sizes.personId, personId)));
  return {noClothes: person?.noClothes ?? false, sizes: Object.fromEntries(rows.map(({kind, value}) => [kind, value])) as Record<string, string>};
}

/** How many things are on someone's list, for "1 thing on your list". */
export async function listCount(tx: FamilyTransaction, familyId: string, ownerId: string) {
  const [row] = await tx.select({total: count()}).from(items)
    .where(and(eq(items.familyId, familyId), eq(items.ownerId, ownerId), isNull(items.archivedAt)));
  return row?.total ?? 0;
}

/** Whether this browser has Face ID for the signed-in person. */
export async function faceIdOnDevice(tx: FamilyTransaction, viewer: Viewer) {
  const devices = await signedInDevices(tx, viewer, new Date());
  return devices.some(({current, faceId}) => current && faceId);
}

/**
 * Only joining may include a person's name; PIN resets and disputed-key activity must stay anonymous.
 * Pairing details must never enter this projection.
 */
export async function familyActivity(tx: FamilyTransaction, familyId: string) {
  const rows = await tx.select({
    id: authEvents.id, kind: authEvents.kind, at: authEvents.at, name: people.displayName,
  }).from(authEvents)
    .innerJoin(people, and(eq(people.familyId, authEvents.familyId), eq(people.id, authEvents.personId)))
    .where(and(eq(authEvents.familyId, familyId), inArray(authEvents.kind, ["keyUsed", "resetUsed", "keyDisputed", "familyLockdown"])))
    .orderBy(desc(authEvents.at)).limit(60);
  const seen = new Set<number>();
  const out: Array<{id: string; kind: "joined" | "reset" | "secondPhone" | "paused"; at: Date; name?: string}> = [];
  for (const row of rows) {
    if (row.kind === "familyLockdown") {
      // one lockdown writes a row per person: show it once
      const minute = Math.floor(row.at.getTime() / 60_000);
      if (seen.has(minute)) continue;
      seen.add(minute);
      out.push({id: row.id, kind: "paused", at: row.at});
    } else if (row.kind === "keyUsed") out.push({id: row.id, kind: "joined", at: row.at, name: row.name});
    else if (row.kind === "resetUsed") out.push({id: row.id, kind: "reset", at: row.at});
    else out.push({id: row.id, kind: "secondPhone", at: row.at});
  }
  return out.slice(0, 30);
}
