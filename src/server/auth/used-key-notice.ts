import {randomUUID} from "node:crypto";
import {and, eq, gt, isNull, like, ne} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {outbox, people} from "../db/schema";
import {enqueueMessages} from "../messages/queue";
import type {Viewer} from "./index";
import {authEvents, personalKeys} from "./schema";
import {revalidateViewer} from "./session";

const HOUR = 60 * 60_000;

export async function recordUsedKeyOpening(
  tx: FamilyTransaction, key: typeof personalKeys.$inferSelect, viewer: Viewer | null, now: Date,
  openingId: string = randomUUID(),
) {
  const {familyId, personId} = key;
  if (!key.usedAt) return null;
  if (viewer?.familyId === familyId && viewer.personId === personId && await revalidateViewer(tx, viewer)) return null;
  const [owner] = await tx.select().from(people).where(and(
    eq(people.familyId, familyId), eq(people.id, personId), isNull(people.removedAt),
  ));
  if (!owner) return null;

  const dedupeKey = `key-opening:${key.id}:${openingId}`;
  const [existing] = await tx.select({id: outbox.id}).from(outbox).where(and(
    eq(outbox.familyId, familyId), eq(outbox.personId, personId), eq(outbox.dedupeKey, dedupeKey),
  )).limit(1);
  if (existing) return {queued: false, canConfirm: !owner.helperId};

  const [recentPush] = await tx.select({id: outbox.id}).from(outbox).where(and(
    eq(outbox.familyId, familyId), eq(outbox.personId, personId),
    like(outbox.dedupeKey, `key-opening:${key.id}:%`), ne(outbox.status, "skipped"),
    gt(outbox.createdAt, new Date(now.getTime() - HOUR)),
  )).limit(1);
  await tx.insert(authEvents).values({familyId, personId, keyId: key.id, kind: "keyOpenedElsewhere", at: now});
  await enqueueMessages(tx, [{
    familyId, personId, language: owner.language, template: "key-opened-elsewhere", createdAt: now,
    dedupeKey, push: !recentPush,
  }]);
  return {queued: true, canConfirm: !owner.helperId};
}
