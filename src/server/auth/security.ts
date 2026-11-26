import {and, desc, eq, inArray, isNull, ne} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {people} from "../db/schema";
import {activePerson, lockFamily} from "./access";
import type {Viewer} from "./index";
import {authEvents, passkeys, personalKeys, pinCredentials, sessionDisputes, sessions} from "./schema";
import {revalidateViewer} from "./session";

export async function account(tx: FamilyTransaction, viewer: Viewer) {
  const {familyId, personId} = viewer;
  const person = await activePerson(tx, familyId, personId);
  const helpers = await tx.select({id: people.id, name: people.displayName}).from(people).where(and(
    eq(people.familyId, familyId), eq(people.helperId, personId), isNull(people.removedAt),
  )).orderBy(people.displayName);
  const activity = await tx.select({
    id: authEvents.id, kind: authEvents.kind, at: authEvents.at, deviceKind: authEvents.deviceKind,
    sessionId: authEvents.sessionId, disputed: sessionDisputes.eventId,
  }).from(authEvents).leftJoin(sessionDisputes, and(
    eq(sessionDisputes.familyId, authEvents.familyId), eq(sessionDisputes.eventId, authEvents.id),
  )).where(and(eq(authEvents.familyId, familyId), eq(authEvents.personId, personId)))
    .orderBy(desc(authEvents.at)).limit(50);
  return {name: person?.displayName ?? "", helpers, activity};
}

export async function actFor(tx: FamilyTransaction, viewer: Viewer, actingAs: string) {
  const {familyId, personId, sessionId} = viewer;
  await lockFamily(tx, familyId);
  if (!await revalidateViewer(tx, viewer)) return false;
  if (actingAs !== personId) {
    const person = await activePerson(tx, familyId, actingAs);
    if (person?.helperId !== personId) return false;
  }
  const [session] = await tx.update(sessions).set({actingAs}).where(and(
    eq(sessions.familyId, familyId), eq(sessions.id, sessionId), eq(sessions.personId, personId), isNull(sessions.revokedAt),
  )).returning({id: sessions.id});
  return Boolean(session);
}

export async function endSessions(tx: FamilyTransaction, viewer: Viewer, now: Date, all: boolean) {
  const {familyId, personId, sessionId} = viewer;
  await lockFamily(tx, familyId);
  if (!await revalidateViewer(tx, viewer)) return false;
  await tx.update(sessions).set(all ? {revokedAt: now, trusted: false} : {revokedAt: now}).where(and(
    eq(sessions.familyId, familyId), eq(sessions.personId, personId), all ? undefined : eq(sessions.id, sessionId),
  ));
  return true;
}

export async function disputeEvent(tx: FamilyTransaction, viewer: Viewer, eventId: string, now: Date) {
  const {familyId, personId, sessionId} = viewer;
  await lockFamily(tx, familyId);
  if (!await revalidateViewer(tx, viewer)) return false;
  const [event] = await tx.select({kind: authEvents.kind, sessionId: authEvents.sessionId, keyId: authEvents.keyId})
    .from(authEvents).where(and(eq(authEvents.familyId, familyId), eq(authEvents.personId, personId), eq(authEvents.id, eventId)));
  if (!event || event.kind === "pinLocked" || event.kind === "newDevicesLocked" || event.kind === "keyDisputed") return false;
  let targetId = event.sessionId;
  if (event.keyId) {
    const [key] = await tx.select({sessionId: personalKeys.usedSessionId}).from(personalKeys).where(and(
      eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), eq(personalKeys.id, event.keyId),
    ));
    targetId ??= key?.sessionId ?? null;
  }
  const disputedSessionId = targetId === sessionId ? null : targetId;
  const personSessions = disputedSessionId ? await tx.select({
    id: sessions.id, hash: sessions.deviceHash, passkeyId: sessions.passkeyId,
  }).from(sessions).where(and(eq(sessions.familyId, familyId), eq(sessions.personId, personId))) : [];
  const target = personSessions.find(({id}) => id === disputedSessionId);
  const personCredentials = target ? await tx.select({id: passkeys.id, hash: passkeys.deviceHash}).from(passkeys)
    .where(and(eq(passkeys.familyId, familyId), eq(passkeys.personId, personId))) : [];
  const deviceHashes = new Set(target ? [target.hash] : []);
  const credentialIds = new Set(target?.passkeyId ? [target.passkeyId] : []);
  let expanded = true;
  while (expanded) {
    const size = deviceHashes.size + credentialIds.size;
    for (const credential of personCredentials) {
      if (deviceHashes.has(credential.hash)) credentialIds.add(credential.id);
    }
    for (const session of personSessions) {
      if (session.id !== sessionId && session.passkeyId && credentialIds.has(session.passkeyId)) deviceHashes.add(session.hash);
    }
    expanded = size !== deviceHashes.size + credentialIds.size;
  }
  if (event.keyId) await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), eq(personalKeys.id, event.keyId),
  ));
  const [record] = await tx.insert(sessionDisputes).values({
    familyId, eventId, personId, disputedSessionId, reportedBySessionId: sessionId, at: now,
  }).onConflictDoNothing().returning({id: sessionDisputes.eventId});
  if (!record) return true;
  if (!target) return true;
  await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), eq(personalKeys.issuedBy, personId),
    eq(personalKeys.kind, "reset"), isNull(personalKeys.usedAt), isNull(personalKeys.revokedAt),
  ));
  await tx.update(passkeys).set({revokedAt: now}).where(and(
    eq(passkeys.familyId, familyId), eq(passkeys.personId, personId),
    inArray(passkeys.id, [...credentialIds]),
  ));
  await tx.update(sessions).set({revokedAt: now, trusted: false}).where(and(
    eq(sessions.familyId, familyId), eq(sessions.personId, personId),
    inArray(sessions.deviceHash, [...deviceHashes]),
    ne(sessions.id, sessionId),
  ));
  await tx.update(pinCredentials).set({newDevicesLocked: true}).where(and(
    eq(pinCredentials.familyId, familyId), eq(pinCredentials.personId, personId),
  ));
  return true;
}

/** Phase 2 can read reports for the current family and person from this projection. */
export async function listSessionDisputes(tx: FamilyTransaction, familyId: string, personId: string) {
  return tx.select({sessionId: sessionDisputes.disputedSessionId, at: sessionDisputes.at})
    .from(sessionDisputes).where(and(eq(sessionDisputes.familyId, familyId), eq(sessionDisputes.personId, personId)))
    .orderBy(desc(sessionDisputes.at));
}

export async function listKeyDisputes(tx: FamilyTransaction, familyId: string, personId: string) {
  return tx.select({keyId: authEvents.keyId, sessionId: authEvents.sessionId, deviceKind: authEvents.deviceKind, at: authEvents.at})
    .from(authEvents).where(and(
      eq(authEvents.familyId, familyId), eq(authEvents.personId, personId), eq(authEvents.kind, "keyDisputed"),
    )).orderBy(desc(authEvents.at));
}
