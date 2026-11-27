import {and, eq, isNotNull, isNull} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {people} from "../db/schema";
import {lockFamily} from "./access";
import type {Viewer} from "./index";
import {sessions} from "./schema";
import {revalidateViewer} from "./session";

const borrowedSession = (viewer: Viewer) => and(
  eq(sessions.familyId, viewer.familyId), eq(sessions.id, viewer.sessionId), eq(sessions.personId, viewer.personId),
  isNotNull(sessions.lentBySessionId), isNull(sessions.revokedAt),
);

/**
 * "Hide Beto": from now on this session has no sealed draw access, so whoever holds the phone next cannot
 * open the person again. Returns whether the session was on a borrowed phone and is now hidden.
 */
export async function hideBorrowedPerson(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  await lockFamily(tx, viewer.familyId);
  const current = await revalidateViewer(tx, viewer);
  if (!current) return Boolean(viewer.borrowed);
  if (!current.borrowed) return false;
  if (current.borrowed.hidden) return true;
  const [hidden] = await tx.update(sessions).set({personHiddenAt: now}).where(borrowedSession(viewer))
    .returning({id: sessions.id});
  return Boolean(hidden);
}

/**
 * "Sign Rosa out of this phone": ends the borrowed session, so the phone is its owner's again. Ending a
 * session that already lapsed is fine; a session that is not borrowed is never ended here.
 */
export async function returnBorrowedPhone(tx: FamilyTransaction, viewer: Viewer, now: Date) {
  await lockFamily(tx, viewer.familyId);
  await tx.update(sessions).set({revokedAt: now, personHiddenAt: now}).where(borrowedSession(viewer));
}

/** Whose phone this is, for "Then hand the phone back to Ana". */
export async function phoneOwnerName(tx: FamilyTransaction, viewer: Viewer) {
  if (!viewer.borrowed) return null;
  const [owner] = await tx.select({name: people.displayName}).from(sessions)
    .innerJoin(people, and(eq(people.familyId, sessions.familyId), eq(people.id, sessions.personId)))
    .where(and(eq(sessions.familyId, viewer.familyId), eq(sessions.id, viewer.borrowed.lenderSessionId)));
  return owner?.name ?? null;
}
