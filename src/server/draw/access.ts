import "server-only";
import {and, eq, isNull, sql} from "drizzle-orm";
import {connectDatabase, type FamilyTransaction} from "../db/database";
import type {Viewer} from "../auth";
import {revalidateViewer} from "../auth/session";
import {practiceFamilies} from "./schema";
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
const practiceDelegations = new WeakMap<DrawViewer, {owner: DrawViewer; practice: typeof practiceFamilies.$inferSelect}>();

export function delegatePractice(owner: DrawViewer, practice: typeof practiceFamilies.$inferSelect, personId: string): DrawViewer {
  const viewer = Object.freeze({
    familyId: practice.practiceFamilyId, sessionId: owner.sessionId,
    personId, actingAs: personId, isOrganizer: personId === practice.practiceOrganizerId,
  });
  practiceDelegations.set(viewer, {owner: {...owner}, practice: {...practice}});
  return viewer;
}

export async function scopeDrawFamily(tx: FamilyTransaction, familyId: string) {
  await tx.execute(sql`SELECT set_config('app.family_id', ${familyId}::uuid::text, true)`);
}

export function withDrawFamily<T>(
  viewer: DrawViewer,
  action: (transaction: FamilyTransaction) => Promise<T>,
  familyLock: "share" | "update" = "share",
): Promise<T> {
  if (!connection) {
    const databaseUrl = process.env.DRAW_DATABASE_URL;
    if (!databaseUrl) throw new Error("DRAW_DATABASE_URL is required for sealed draw access");
    connection = connectDatabase(databaseUrl);
  }
  const delegation = practiceDelegations.get(viewer);
  const actor = delegation?.owner ?? viewer;
  const familyId = actor.familyId;
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql`SET LOCAL ROLE fge_draw`);
    await scopeDrawFamily(transaction, familyId);
    // Family management takes the same family row before changing people or exchanges.
    await transaction.select({id: families.id}).from(families).where(eq(families.id, familyId)).for(familyLock);
    const current = await revalidateViewer(transaction, actor);
    // a person hidden on a borrowed phone stays hidden from whoever holds it next
    if (!current || current.actingAs !== actor.actingAs || current.borrowed?.hidden) throw new DrawError("forbidden");
    if (delegation) {
      if (!current.isOrganizer || current.actingAs !== current.personId) throw new DrawError("forbidden");
      const [practice] = await transaction.select().from(practiceFamilies).where(and(
        eq(practiceFamilies.familyId, familyId), eq(practiceFamilies.ownerId, current.personId),
      ));
      if (!practice || practice.practiceFamilyId !== delegation.practice.practiceFamilyId
        || practice.practiceOrganizerId !== delegation.practice.practiceOrganizerId
        || practice.exchangeId !== delegation.practice.exchangeId) throw new DrawError("forbidden");
      await scopeDrawFamily(transaction, viewer.familyId);
      await transaction.select({id: families.id}).from(families)
        .where(eq(families.id, viewer.familyId)).for(familyLock);
    }
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
