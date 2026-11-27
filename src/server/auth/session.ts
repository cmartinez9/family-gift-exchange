import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {and, eq, gt, isNotNull, isNull, lte, or} from "drizzle-orm";
import {alias} from "drizzle-orm/pg-core";
import {people} from "../db/schema";
import type {FamilyTransaction} from "../db/database";
import {sessions} from "./schema";
import type {Viewer} from "./index";

export const sessionCookie = "__Host-fge-session";
/** A relative's session on this phone, opened inside the owner's: see `getViewer`. */
export const borrowedCookie = "__Host-fge-borrowed";
export const seasonSeconds = 365 * 24 * 60 * 60;
export const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export function secret() {
  return randomBytes(32).toString("base64url");
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function equalDigests(left: string, right: string) {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function matchesHash(value: string, hash: string) {
  return equalDigests(digest(value), hash);
}

export function parseSession(value: string | undefined) {
  const [familyId, id, token, extra] = (value ?? "").split(".");
  if (extra !== undefined || !uuidPattern.test(familyId) || !uuidPattern.test(id ?? "")
    || !secretPattern.test(token ?? "")) return null;
  return {familyId, id, token};
}

async function sessionIdentity(tx: FamilyTransaction, familyId: string, id: string) {
  const target = alias(people, "acting_person");
  const lender = alias(sessions, "lender_session");
  const now = new Date();
  const [row] = await tx.select({
    personId: people.id,
    role: people.role,
    tokenHash: sessions.tokenHash,
    deviceHash: sessions.deviceHash,
    actingAs: target.id,
    helperId: target.helperId,
    lentBy: sessions.lentBySessionId,
    lenderPersonId: lender.personId,
    personHiddenAt: sessions.personHiddenAt,
  }).from(sessions)
    .innerJoin(people, and(eq(people.familyId, sessions.familyId), eq(people.id, sessions.personId)))
    .leftJoin(target, and(eq(target.familyId, sessions.familyId), eq(target.id, sessions.actingAs), isNull(target.removedAt)))
    // a session on a borrowed phone lives only as long as the owner's session it was opened inside
    .leftJoin(lender, and(eq(lender.familyId, sessions.familyId), eq(lender.id, sessions.lentBySessionId),
      isNull(lender.revokedAt), gt(lender.expiresAt, now), isNull(lender.lentBySessionId)))
    .where(and(eq(sessions.familyId, familyId), eq(sessions.id, id), isNull(sessions.revokedAt),
      gt(sessions.expiresAt, now), isNull(people.removedAt), isNull(people.helperId),
      or(isNull(sessions.lentBySessionId), isNotNull(lender.id))));
  return row;
}

function viewerIdentity(row: NonNullable<Awaited<ReturnType<typeof sessionIdentity>>>, familyId: string, id: string): Viewer {
  return {
    personId: row.personId,
    familyId,
    sessionId: id,
    isOrganizer: row.role === "organizer" || row.role === "co_organizer",
    actingAs: row.helperId === row.personId && row.actingAs ? row.actingAs : row.personId,
    ...(row.lentBy && row.lenderPersonId ? {borrowed: {
      lenderSessionId: row.lentBy, lenderPersonId: row.lenderPersonId, hidden: row.personHiddenAt !== null,
    }} : {}),
  };
}

export async function findViewer(tx: FamilyTransaction, session: NonNullable<ReturnType<typeof parseSession>>): Promise<Viewer | null> {
  const {familyId, id, token} = session;
  const row = await sessionIdentity(tx, familyId, id);
  return row && matchesHash(token, row.tokenHash) ? viewerIdentity(row, familyId, id) : null;
}

export const lastUsedGraceMs = 15 * 60_000;

export async function touchSession(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  await tx.update(sessions).set({lastUsedAt: now}).where(and(
    eq(sessions.familyId, viewer.familyId), eq(sessions.id, viewer.sessionId), isNull(sessions.revokedAt),
    or(isNull(sessions.lastUsedAt), lte(sessions.lastUsedAt, new Date(now.getTime() - lastUsedGraceMs))),
  ));
}

export async function revalidateViewer(tx: FamilyTransaction, viewer: Pick<Viewer, "familyId" | "sessionId" | "personId">): Promise<(Viewer & {deviceHash: string}) | null> {
  const {familyId, sessionId, personId} = viewer;
  const row = await sessionIdentity(tx, familyId, sessionId);
  return row?.personId === personId ? {...viewerIdentity(row, familyId, sessionId), deviceHash: row.deviceHash} : null;
}

export async function createSession(
  tx: FamilyTransaction,
  familyId: string,
  personId: string,
  deviceHash: string,
  deviceKind: string,
  now: Date,
  passkeyId: string | null = null,
  /** On a borrowed phone: the owner's session, and how long this one may last inside it. */
  lend?: {lenderSessionId: string; seconds: number},
) {
  const id = randomUUID();
  const token = secret();
  const [person] = await tx.select({role: people.role}).from(people).where(and(eq(people.familyId, familyId), eq(people.id, personId)));
  await tx.insert(sessions).values({
    familyId, id, personId, actingAs: personId, deviceHash, deviceKind, passkeyId,
    hadOrganizerAccess: person.role === "organizer" || person.role === "co_organizer",
    tokenHash: digest(token), createdAt: now, expiresAt: new Date(now.getTime() + (lend?.seconds ?? seasonSeconds) * 1000),
    // a borrowed phone is never one of this person's own
    ...(lend ? {lentBySessionId: lend.lenderSessionId, trusted: false} : {}),
  });
  return {id, cookie: `${familyId}.${id}.${token}`};
}
