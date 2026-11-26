import "server-only";
import {and, eq, isNull, sql} from "drizzle-orm";
import {connectDatabase, type FamilyTransaction} from "../db/database";
import type {Viewer} from "../auth";
import {families, people} from "../db/schema";

export type DrawViewer = Viewer;

export type DrawErrorCode =
  | "forbidden" | "notFound" | "closed" | "exchangeAlreadyOpen" | "invalidDetails" | "invalidParticipants"
  | "invalidKeepApart" | "drawLocked" | "confirmationRequired" | "drawImpossible"
  | "checkTimedOut" | "repairImpossible" | "alreadyReported" | "revealFirst"
  | "invalidQuestion" | "alreadyAnswered" | "drawChanged";

export class DrawError extends Error {
  constructor(readonly code: DrawErrorCode) {
    super(code);
    this.name = "DrawError";
  }
}

let connection: ReturnType<typeof connectDatabase> | undefined;

export async function scopeDrawFamily(tx: FamilyTransaction, familyId: string) {
  await tx.execute(sql`SELECT set_config('app.family_id', ${familyId}::uuid::text, true)`);
}

export function withDrawFamily<T>(
  familyId: string,
  action: (transaction: FamilyTransaction) => Promise<T>,
  familyLock: "share" | "update" = "share",
): Promise<T> {
  if (!connection) {
    const databaseUrl = process.env.DRAW_DATABASE_URL;
    if (!databaseUrl) throw new Error("DRAW_DATABASE_URL is required for sealed draw access");
    connection = connectDatabase(databaseUrl);
  }
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql`SET LOCAL ROLE fge_draw`);
    await scopeDrawFamily(transaction, familyId);
    // Family management takes the same family row before changing people or exchanges.
    await transaction.select({id: families.id}).from(families).where(eq(families.id, familyId)).for(familyLock);
    return action(transaction);
  });
}

export function requireOrganizer(viewer: DrawViewer) {
  if (!viewer.isOrganizer || viewer.personId !== viewer.actingAs) throw new DrawError("forbidden");
}

export async function lockOrganizer(
  tx: FamilyTransaction, viewer: DrawViewer, strength: "share" | "update" = "share",
) {
  const [actor] = await tx.select({role: people.role}).from(people).where(and(
    eq(people.familyId, viewer.familyId), eq(people.id, viewer.personId),
    isNull(people.removedAt), isNull(people.helperId),
  )).for(strength);
  if (!actor || (actor.role !== "organizer" && actor.role !== "co_organizer")) {
    throw new DrawError("forbidden");
  }
}

export async function authorizeSubject(tx: FamilyTransaction, viewer: DrawViewer) {
  const [subject] = await tx.select({id: people.id, helperId: people.helperId}).from(people).where(and(
    eq(people.familyId, viewer.familyId), eq(people.id, viewer.actingAs), isNull(people.removedAt),
  )).for("share");
  if (!subject || (subject.helperId ?? subject.id) !== viewer.personId) throw new DrawError("forbidden");
  if (subject.helperId) {
    const [helper] = await tx.select({id: people.id}).from(people).where(and(
      eq(people.familyId, viewer.familyId), eq(people.id, viewer.personId),
      isNull(people.removedAt), isNull(people.helperId),
    )).for("share");
    if (!helper) throw new DrawError("forbidden");
  }
  return subject.id;
}
