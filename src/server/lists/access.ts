import "server-only";
import {and, eq, isNull} from "drizzle-orm";
import type {Viewer} from "../auth";
import {revalidateViewer} from "../auth/session";
import type {FamilyTransaction} from "../db/database";
import {families, people} from "../db/schema";

export type ListViewer = Viewer;

export class ListError extends Error {
  constructor(readonly code:
    | "not-found" | "forbidden" | "invalid-item" | "invalid-size"
    | "invalid-profile" | "invalid-budget" | "closed" | "already-claimed"
    | "item-changed" | "invalid-photo" | "storage-unavailable",
  ) {
    super(code);
  }
}

export const isListId = (id: string) =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

export async function requireListPerson(
  tx: FamilyTransaction,
  familyId: string,
  personId: string,
  lock = false,
) {
  if (!isListId(personId)) throw new ListError("not-found");
  const query = tx.select({
    id: people.id,
    displayName: people.displayName,
    helperId: people.helperId,
    noClothes: people.noClothes,
  }).from(people).where(and(
    eq(people.familyId, familyId), eq(people.id, personId), isNull(people.removedAt),
  ));
  const [person] = await (lock ? query.for("no key update") : query);
  if (!person) throw new ListError("not-found");
  return person;
}

export async function requireListActor(tx: FamilyTransaction, viewer: ListViewer) {
  await tx.select({id: families.id}).from(families).where(eq(families.id, viewer.familyId)).for("share");
  const current = await revalidateViewer(tx, viewer);
  if (!current || current.actingAs !== viewer.actingAs || current.isOrganizer !== viewer.isOrganizer) {
    throw new ListError("forbidden");
  }
  const member = await requireListPerson(tx, viewer.familyId, viewer.personId);
  if (viewer.actingAs === viewer.personId) return member;
  const actor = await requireListPerson(tx, viewer.familyId, viewer.actingAs);
  if (actor.helperId !== viewer.personId) throw new ListError("forbidden");
  return actor;
}

export async function requireListEditor(
  tx: FamilyTransaction, viewer: ListViewer, ownerId: string, lock = false,
) {
  await requireListActor(tx, viewer);
  const owner = await requireListPerson(tx, viewer.familyId, ownerId, lock);
  if (owner.id !== viewer.actingAs) throw new ListError("forbidden");
  return owner;
}

export function hidesClaims(viewer: Pick<ListViewer, "personId" | "actingAs">, ownerId: string) {
  const owner = ownerId.toLowerCase();
  return owner === viewer.personId.toLowerCase() || owner === viewer.actingAs.toLowerCase();
}
