import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {and, eq, gt, isNull} from "drizzle-orm";
import {alias} from "drizzle-orm/pg-core";
import {people} from "../db/schema";
import type {FamilyTransaction} from "../db/database";
import {sessions} from "./schema";
import type {Viewer} from "./index";

export const sessionCookie = "__Host-fge-session";
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

export async function findViewer(tx: FamilyTransaction, session: NonNullable<ReturnType<typeof parseSession>>): Promise<Viewer | null> {
  const {familyId, id, token} = session;
  const target = alias(people, "acting_person");
  const [row] = await tx.select({
    personId: people.id,
    role: people.role,
    tokenHash: sessions.tokenHash,
    actingAs: target.id,
    helperId: target.helperId,
  }).from(sessions)
    .innerJoin(people, and(eq(people.familyId, sessions.familyId), eq(people.id, sessions.personId)))
    .leftJoin(target, and(eq(target.familyId, sessions.familyId), eq(target.id, sessions.actingAs), isNull(target.removedAt)))
    .where(and(eq(sessions.familyId, familyId), eq(sessions.id, id), isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()), isNull(people.removedAt), isNull(people.helperId)));
  if (!row || !matchesHash(token, row.tokenHash)) return null;
  return {
    personId: row.personId,
    familyId,
    sessionId: id,
    isOrganizer: row.role === "organizer" || row.role === "co_organizer",
    actingAs: row.helperId === row.personId && row.actingAs ? row.actingAs : row.personId,
  };
}

export async function createSession(
  tx: FamilyTransaction,
  familyId: string,
  personId: string,
  deviceHash: string,
  deviceKind: string,
  now: Date,
) {
  const id = randomUUID();
  const token = secret();
  await tx.insert(sessions).values({
    familyId, id, personId, actingAs: personId, deviceHash, deviceKind,
    tokenHash: digest(token), createdAt: now, expiresAt: new Date(now.getTime() + seasonSeconds * 1000),
  });
  return {id, cookie: `${familyId}.${id}.${token}`};
}
