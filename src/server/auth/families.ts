import {randomUUID} from "node:crypto";
import {and, asc, count, desc, eq, gt, inArray, isNull, sql} from "drizzle-orm";
import type {Locale} from "@/i18n/routing";
import type {FamilyTransaction} from "../db/database";
import {claims, exchanges, families, households, keepApart, participants, people} from "../db/schema";
import type {Viewer} from "./index";
import {activePerson, isManager, lockFamily, signInDevice, type Device} from "./access";
import {hashPin, keyedHash} from "./pin";
import {equalDigests} from "./session";
import {organizerContacts} from "./account";
import {authEvents, passkeys, personalKeys, pinCredentials, pinResetRequests, sessions} from "./schema";

export function permitCreation(configured: string | undefined, entered: string, pepper: string) {
  if (!configured || configured.length < 16) return false;
  return equalDigests(keyedHash(pepper, "organizer-code", entered), keyedHash(pepper, "organizer-code", configured));
}

export async function createFamily(tx: FamilyTransaction, input: {
  familyId: string; familyName: string; displayName: string; language: Locale;
  pin: string; pepper: string; device: Device; now: Date;
}) {
  const {familyId, familyName, displayName, language, pin, pepper, device, now} = input;
  const personId = randomUUID();
  await tx.insert(families).values({id: familyId, name: familyName, defaultLanguage: language});
  await tx.insert(people).values({familyId, id: personId, displayName, language, role: "organizer"});
  await tx.update(families).set({createdBy: personId}).where(eq(families.id, familyId));
  await tx.insert(pinCredentials).values({familyId, personId, pinHash: await hashPin(pepper, pin), joinedAt: now, changedAt: now});
  const [{id: exchangeId}] = await tx.insert(exchanges).values({familyId, name: familyName}).returning({id: exchanges.id});
  await tx.insert(participants).values({familyId, exchangeId, personId, joinedAt: now});
  return signInDevice(tx, familyId, personId, device, now);
}

function currentExchangeQuery(tx: FamilyTransaction, familyId: string) {
  return tx.select({id: exchanges.id, status: exchanges.status}).from(exchanges)
    .where(eq(exchanges.familyId, familyId))
    .orderBy(sql`(${exchanges.status} = 'closed')`, desc(exchanges.giftDay), asc(exchanges.id)).limit(1);
}

async function currentExchange(tx: FamilyTransaction, familyId: string) {
  const [row] = await currentExchangeQuery(tx, familyId).for("update");
  return row;
}

const peopleOnly = (familyId: string) => and(eq(people.familyId, familyId), isNull(people.removedAt));

export async function signInFamily(tx: FamilyTransaction, familyId: string) {
  const [family] = await tx.select({name: families.name}).from(families).where(eq(families.id, familyId));
  if (!family) return null;
  const members = await tx.select({
    id: people.id, name: people.displayName, needsNewKey: people.needsNewKey, credentialId: pinCredentials.personId,
  }).from(people)
    .leftJoin(pinCredentials, and(eq(pinCredentials.familyId, people.familyId), eq(pinCredentials.personId, people.id)))
    .where(and(peopleOnly(familyId), isNull(people.helperId))).orderBy(people.displayName, people.id);
  return {
    name: family.name,
    names: members.filter(({credentialId}) => credentialId !== null).map(({id, name, needsNewKey}) => ({id, name, needsNewKey})),
    helpNames: members.map(({id, name}) => ({id, name})),
    organizers: await organizerContacts(tx, familyId),
  };
}

export async function readiness(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  if (!await isManager(tx, viewer)) return null;
  const {familyId} = viewer;
  const [family] = await tx.select({name: families.name}).from(families).where(eq(families.id, familyId));
  const members = await tx.select({
    id: people.id, name: people.displayName, helperId: people.helperId,
    householdId: people.householdId, language: people.language, role: people.role,
    joinedAt: pinCredentials.joinedAt,
    needsNewKey: people.needsNewKey,
  }).from(people).leftJoin(pinCredentials, and(eq(pinCredentials.familyId, people.familyId), eq(pinCredentials.personId, people.id)))
    .where(peopleOnly(familyId)).orderBy(people.displayName);
  const sent = await tx.selectDistinct({personId: personalKeys.personId}).from(personalKeys)
    .where(and(eq(personalKeys.familyId, familyId), gt(personalKeys.expiresAt, now),
      isNull(personalKeys.revokedAt), gt(personalKeys.sentAt, new Date(0))));
  const devices = await tx.select({personId: sessions.personId, kind: sessions.deviceKind, at: sessions.createdAt})
    .from(sessions).where(and(eq(sessions.familyId, familyId), eq(sessions.trusted, true)))
    .orderBy(desc(sessions.createdAt));
  const groups = await tx.select({id: households.id, name: households.name}).from(households)
    .where(eq(households.familyId, familyId)).orderBy(households.name);
  const [exchange] = await currentExchangeQuery(tx, familyId);
  const pairs = exchange ? await tx.select({personA: keepApart.personA, personB: keepApart.personB})
    .from(keepApart).where(and(eq(keepApart.familyId, familyId), eq(keepApart.exchangeId, exchange.id))) : [];
  const requests = await tx.select({
    personId: pinResetRequests.personId, deviceKind: pinResetRequests.deviceKind, at: pinResetRequests.requestedAt,
  }).from(pinResetRequests).where(and(eq(pinResetRequests.familyId, familyId), isNull(pinResetRequests.answeredAt)))
    .orderBy(desc(pinResetRequests.requestedAt));
  const activityKinds = ["keyDisputed", "resetPrepared", "resetPreparedWithoutRequest", "resetSent", "resetUsed", "pinLocked", "newDevicesLocked"] as const;
  const activity = await tx.select({
    personId: authEvents.personId, kind: sql<typeof activityKinds[number]>`${authEvents.kind}`, at: authEvents.at, deviceKind: authEvents.deviceKind,
  })
    .from(authEvents).where(and(eq(authEvents.familyId, familyId),
      inArray(authEvents.kind, activityKinds)))
    .orderBy(desc(authEvents.at)).limit(30);
  return {
    familyName: family.name, members, devices, groups, pairs, requests, sent, activity,
    exchangeId: exchange?.id ?? null,
    canSendKeys: true,
    constraintsOpen: exchange?.status === "open" || exchange?.status === "setup",
  };
}

export type MemberInput = {
  name: string; language: Locale; helperId: string | null; householdId: string | null;
};

export async function saveMember(tx: FamilyTransaction, viewer: Viewer, id: string | null, input: MemberInput) {
  const {familyId} = viewer;
  await lockFamily(tx, familyId);
  if (!await isManager(tx, viewer)) return "forbidden";
  const existing = id ? await activePerson(tx, familyId, id) : null;
  if (id && !existing) return "unavailable";
  const exchange = await currentExchange(tx, familyId);
  const setup = exchange?.status === "setup" || exchange?.status === "open";
  if (existing && !setup && (input.helperId !== existing.helperId || input.householdId !== existing.householdId)) {
    return "drawStarted";
  }
  if (!existing) {
    const [{total}] = await tx.select({total: count()}).from(people).where(peopleOnly(familyId));
    if (total >= 60) return "familyFull";
  }
  if (input.helperId) {
    if (input.helperId === id || (existing && existing.role !== "member")) return "invalidHelper";
    const helper = await activePerson(tx, familyId, input.helperId);
    if (!helper || helper.helperId) return "invalidHelper";
    if (id) {
      const [dependent] = await tx.select({id: people.id}).from(people).where(and(peopleOnly(familyId), eq(people.helperId, id))).limit(1);
      const [joined] = await tx.select({personId: pinCredentials.personId}).from(pinCredentials)
        .where(and(eq(pinCredentials.familyId, familyId), eq(pinCredentials.personId, id)));
      if (dependent || joined) return "invalidHelper";
    }
  }
  if (input.householdId) {
    const [group] = await tx.select({id: households.id}).from(households)
      .where(and(eq(households.familyId, familyId), eq(households.id, input.householdId)));
    if (!group) return "unavailable";
  }
  const values = {displayName: input.name, language: input.language, householdId: input.householdId, helperId: input.helperId};
  if (id) {
    await tx.update(people).set(values).where(and(peopleOnly(familyId), eq(people.id, id)));
    if (input.helperId && !existing?.helperId) await tx.update(personalKeys).set({revokedAt: new Date()})
      .where(and(eq(personalKeys.familyId, familyId), eq(personalKeys.personId, id), isNull(personalKeys.revokedAt)));
  } else {
    const [{id: personId}] = await tx.insert(people).values({familyId, ...values}).returning({id: people.id});
    if (setup) await tx.insert(participants).values({familyId, exchangeId: exchange.id, personId});
  }
  return null;
}

export async function removeMember(tx: FamilyTransaction, viewer: Viewer, personId: string, now: Date) {
  const {familyId} = viewer;
  await lockFamily(tx, familyId);
  if (!await isManager(tx, viewer)) return "forbidden";
  const person = await activePerson(tx, familyId, personId);
  if (!person || person.id === viewer.personId || person.role !== "member") return "unavailable";
  const [dependent] = await tx.select({id: people.id}).from(people).where(and(peopleOnly(familyId), eq(people.helperId, personId))).limit(1);
  if (dependent) return "invalidHelper";
  const exchange = await currentExchange(tx, familyId);
  if (exchange) {
    const [participant] = await tx.select({status: participants.status}).from(participants)
      .where(and(eq(participants.familyId, familyId), eq(participants.exchangeId, exchange.id), eq(participants.personId, personId)));
    if (participant?.status === "in" && (exchange.status === "drawn" || exchange.status === "locked")) return "drawStarted";
    await tx.update(participants).set({status: "out"})
      .where(and(eq(participants.familyId, familyId), eq(participants.exchangeId, exchange.id), eq(participants.personId, personId)));
  }
  await tx.update(people).set({removedAt: now}).where(and(peopleOnly(familyId), eq(people.id, personId)));
  await tx.delete(claims).where(and(
    eq(claims.familyId, familyId), eq(claims.claimerId, personId), isNull(claims.boughtAt),
  ));
  await tx.update(personalKeys).set({revokedAt: now}).where(and(
    eq(personalKeys.familyId, familyId), eq(personalKeys.personId, personId), isNull(personalKeys.revokedAt),
  ));
  await tx.update(sessions).set({revokedAt: now, trusted: false}).where(and(eq(sessions.familyId, familyId), eq(sessions.personId, personId)));
  await tx.update(passkeys).set({revokedAt: now}).where(and(eq(passkeys.familyId, familyId), eq(passkeys.personId, personId)));
  return null;
}

export async function changeCoOrganizer(tx: FamilyTransaction, viewer: Viewer, personId: string | null, now = new Date()) {
  const {familyId} = viewer;
  await lockFamily(tx, familyId);
  if (!await isManager(tx, viewer)) return "forbidden";
  if (personId) {
    const person = await activePerson(tx, familyId, personId);
    if (!person || person.helperId || person.role === "organizer") return "unavailable";
    if (person.role === "co_organizer") return null;
  }
  await tx.update(people).set({role: "member", coOrganizerGrantedAt: null}).where(and(peopleOnly(familyId), eq(people.role, "co_organizer")));
  if (personId) {
    await tx.update(people).set({role: "co_organizer", coOrganizerGrantedAt: now}).where(and(peopleOnly(familyId), eq(people.id, personId)));
    await tx.update(sessions).set({hadOrganizerAccess: true}).where(and(
      eq(sessions.familyId, familyId), eq(sessions.personId, personId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now),
    ));
  }
  return null;
}

export async function saveHousehold(tx: FamilyTransaction, viewer: Viewer, id: string | null, name: string | null) {
  const {familyId} = viewer;
  await lockFamily(tx, familyId);
  if (!await isManager(tx, viewer)) return "forbidden";
  if (!id && name) {
    await tx.insert(households).values({familyId, name});
  } else if (id && name) {
    await tx.update(households).set({name}).where(and(eq(households.familyId, familyId), eq(households.id, id)));
  } else if (id) {
    const exchange = await currentExchange(tx, familyId);
    if (exchange?.status === "drawn" || exchange?.status === "locked") return "drawStarted";
    await tx.update(people).set({householdId: null}).where(and(eq(people.familyId, familyId), eq(people.householdId, id)));
    await tx.delete(households).where(and(eq(households.familyId, familyId), eq(households.id, id)));
  }
  return null;
}
