import {and, asc, desc, eq, gte, inArray, isNull, ne, or} from "drizzle-orm";
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
  const [event] = await tx.select({kind: authEvents.kind, sessionId: authEvents.sessionId, keyId: authEvents.keyId, at: authEvents.at})
    .from(authEvents).where(and(eq(authEvents.familyId, familyId), eq(authEvents.personId, personId), eq(authEvents.id, eventId)));
  if (!event || event.kind === "pinLocked" || event.kind === "newDevicesLocked" || event.kind === "keyDisputed" || event.kind === "familyLockdown") return false;
  const person = await activePerson(tx, familyId, personId);
  const organizer = person?.role === "organizer" || person?.role === "co_organizer";
  let targetId = event.sessionId;
  if (event.keyId) {
    const [key] = await tx.select({
      sessionId: personalKeys.usedSessionId, issuedBySessionId: personalKeys.issuedBySessionId,
    }).from(personalKeys).where(and(
      eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), eq(personalKeys.id, event.keyId),
    ));
    const issuance = event.kind === "keyPrepared" || event.kind === "keySent" || event.kind === "resetPrepared"
      || event.kind === "resetPreparedWithoutRequest" || event.kind === "resetSent";
    targetId = issuance ? key?.issuedBySessionId ?? null : targetId ?? key?.sessionId ?? null;
  }
  const disputedSessionId = targetId;
  const familySessions = disputedSessionId ? await tx.select({
    id: sessions.id, personId: sessions.personId, hash: sessions.deviceHash, passkeyId: sessions.passkeyId, createdAt: sessions.createdAt,
    hadOrganizerAccess: sessions.hadOrganizerAccess,
  }).from(sessions).where(eq(sessions.familyId, familyId)) : [];
  const target = familySessions.find((session) => session.id === disputedSessionId);
  const familyCredentials = target ? await tx.select({id: passkeys.id, personId: passkeys.personId, hash: passkeys.deviceHash})
    .from(passkeys).where(eq(passkeys.familyId, familyId)) : [];
  const familyKeys = target ? await tx.select({
    id: personalKeys.id, issuedBySessionId: personalKeys.issuedBySessionId, usedSessionId: personalKeys.usedSessionId,
  }).from(personalKeys).where(eq(personalKeys.familyId, familyId)) : [];
  const deviceHashes = new Set(target ? [`${target.personId}.${target.hash}`] : []);
  const credentialIds = new Set(target?.passkeyId ? [target.passkeyId] : []);
  const sessionIds = new Set(target ? [target.id] : []);
  const causalSessionIds = new Set(target ? [target.id] : []);
  const keyIds = new Set<string>();
  let expanded = true;
  while (expanded) {
    const size = deviceHashes.size + credentialIds.size + sessionIds.size + causalSessionIds.size + keyIds.size;
    for (const credential of familyCredentials) {
      if (deviceHashes.has(`${credential.personId}.${credential.hash}`)) credentialIds.add(credential.id);
    }
    for (const session of familySessions) {
      const device = `${session.personId}.${session.hash}`;
      const onAffectedDevice = deviceHashes.has(device);
      if (onAffectedDevice) sessionIds.add(session.id);
      if (target && session.createdAt >= target.createdAt
        && (causalSessionIds.has(session.id) || onAffectedDevice || (session.passkeyId && credentialIds.has(session.passkeyId)))) {
        sessionIds.add(session.id);
        deviceHashes.add(device);
        causalSessionIds.add(session.id);
        if (session.passkeyId) credentialIds.add(session.passkeyId);
      }
    }
    for (const key of familyKeys) {
      if (key.issuedBySessionId && causalSessionIds.has(key.issuedBySessionId)) {
        keyIds.add(key.id);
        if (key.usedSessionId) {
          sessionIds.add(key.usedSessionId);
          causalSessionIds.add(key.usedSessionId);
        }
      }
    }
    expanded = size !== deviceHashes.size + credentialIds.size + sessionIds.size + causalSessionIds.size + keyIds.size;
  }
  if (event.keyId) await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), eq(personalKeys.id, event.keyId),
  ));
  const [record] = await tx.insert(sessionDisputes).values({
    familyId, eventId, personId, disputedSessionId, reportedBySessionId: sessionId, at: now,
  }).onConflictDoNothing().returning({id: sessionDisputes.eventId});
  if (!record) return true;
  const affectedPeople = familySessions.filter(({id}) => sessionIds.has(id)).map(({personId}) => personId);
  await tx.update(pinCredentials).set({newDevicesLocked: true}).where(and(
    eq(pinCredentials.familyId, familyId), inArray(pinCredentials.personId, affectedPeople),
  ));
  const implicated = familySessions.filter(({id}) => causalSessionIds.has(id));
  if (organizer || implicated.some(({hadOrganizerAccess}) => hadOrganizerAccess)) {
    const earliest = implicated.reduce((at, session) => session.createdAt < at ? session.createdAt : at, target?.createdAt ?? event.at);
    const organizerIds = new Set(implicated.filter(({hadOrganizerAccess}) => hadOrganizerAccess).map(({personId}) => personId));
    if (organizer) organizerIds.add(personId);
    await lockDownFamily(tx, familyId, now, earliest, {
      sessionIds: [...sessionIds], credentialIds: [...credentialIds], organizerIds: [...organizerIds],
    });
    return "lockdown" as const;
  }
  if (!target) return true;
  await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), inArray(personalKeys.id, [...keyIds]),
    isNull(personalKeys.usedAt), isNull(personalKeys.revokedAt),
  ));
  await tx.update(passkeys).set({revokedAt: now}).where(and(
    eq(passkeys.familyId, familyId), inArray(passkeys.id, [...credentialIds]),
  ));
  await tx.update(sessions).set({revokedAt: now, trusted: false}).where(and(
    eq(sessions.familyId, familyId), inArray(sessions.id, [...sessionIds]), ne(sessions.id, sessionId),
  ));
  return true;
}

async function lockDownFamily(
  tx: FamilyTransaction, familyId: string, now: Date, implicatedAt: Date,
  affected: {sessionIds: string[]; credentialIds: string[]; organizerIds: string[]},
) {
  const [earliest] = await tx.select({at: sessions.createdAt}).from(sessionDisputes).innerJoin(sessions, and(
    eq(sessions.familyId, sessionDisputes.familyId), eq(sessions.id, sessionDisputes.disputedSessionId),
  )).where(eq(sessionDisputes.familyId, familyId)).orderBy(asc(sessions.createdAt)).limit(1);
  const since = earliest && earliest.at < implicatedAt ? earliest.at : implicatedAt;
  await tx.update(sessions).set({revokedAt: now}).where(eq(sessions.familyId, familyId));
  await tx.update(personalKeys).set({revokedAt: now}).where(and(eq(personalKeys.familyId, familyId), isNull(personalKeys.usedAt)));
  await tx.update(people).set({role: "member", coOrganizerGrantedAt: null}).where(and(
    eq(people.familyId, familyId), eq(people.role, "co_organizer"), gte(people.coOrganizerGrantedAt, since),
  ));
  await tx.update(passkeys).set({revokedAt: now}).where(and(
    eq(passkeys.familyId, familyId), or(gte(passkeys.enrolledAt, since), inArray(passkeys.id, affected.credentialIds)),
  ));
  const cleared = await tx.update(pinCredentials).set({pinHash: null, newDevicesLocked: true}).where(and(
    eq(pinCredentials.familyId, familyId), or(gte(pinCredentials.changedAt, since), inArray(pinCredentials.personId, affected.organizerIds)),
  )).returning({personId: pinCredentials.personId});
  await tx.update(sessions).set({trusted: false}).where(and(
    eq(sessions.familyId, familyId), or(inArray(sessions.id, affected.sessionIds), inArray(sessions.personId, cleared.map(({personId}) => personId))),
  ));
  await tx.update(people).set({needsNewKey: true}).where(and(eq(people.familyId, familyId), inArray(people.id, cleared.map(({personId}) => personId))));
  await tx.update(people).set({needsNewKey: true}).where(and(eq(people.familyId, familyId), eq(people.role, "organizer")));
  const members = await tx.select({personId: people.id}).from(people).where(and(eq(people.familyId, familyId), isNull(people.removedAt)));
  await tx.insert(authEvents).values(members.map(({personId}) => ({familyId, personId, kind: "familyLockdown" as const, at: now})));
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
