import "server-only";
import {and, eq, gt} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {enqueueMessages} from "../messages/queue";
import type {Viewer} from "./index";
import {activePerson} from "./access";
import {authEvents, personalKeys} from "./schema";
import {revalidateViewer} from "./session";

const HOUR = 60 * 60_000;

/** Called under the family lock, so simultaneous opens share one activity entry and one notice. */
export async function recordUsedKeyOpening(
  tx: FamilyTransaction, key: typeof personalKeys.$inferSelect, viewer: Viewer | null, now: Date,
) {
  const {familyId, personId} = key;
  if (!key.usedAt) return null;
  if (viewer?.familyId === familyId && viewer.personId === personId && await revalidateViewer(tx, viewer)) return null;
  const owner = await activePerson(tx, familyId, personId);
  if (!owner) return null;

  const [recent] = await tx.select({id: authEvents.id}).from(authEvents).where(and(
    eq(authEvents.familyId, familyId), eq(authEvents.personId, personId), eq(authEvents.keyId, key.id),
    eq(authEvents.kind, "keyOpenedElsewhere"), gt(authEvents.at, new Date(now.getTime() - HOUR)),
  )).limit(1);
  if (!recent) {
    await tx.insert(authEvents).values({familyId, personId, keyId: key.id, kind: "keyOpenedElsewhere", at: now});
    await enqueueMessages(tx, [{familyId, personId, language: owner.language, template: "key-opened-elsewhere", createdAt: now}]);
  }
  return {queued: !recent, canConfirm: !owner.helperId};
}
