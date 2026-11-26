import "server-only";
import {and, eq, isNull} from "drizzle-orm";
import type {Viewer} from "../auth";
import {lockFamily} from "../auth/access";
import {revalidateViewer} from "../auth/session";
import type {FamilyTransaction} from "../db/database";
import {people} from "../db/schema";

export type ListViewer = Pick<Viewer, "familyId" | "personId" | "actingAs" | "sessionId">;

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
  await lockFamily(tx, viewer.familyId);
  const current = await revalidateViewer(tx, viewer);
  if (!current || current.actingAs !== viewer.actingAs) throw new ListError("forbidden");
  return current;
}

export async function requireListEditor(
  tx: FamilyTransaction, viewer: ListViewer, ownerId: string, lock = false,
) {
  const current = await requireListActor(tx, viewer);
  const owner = await requireListPerson(tx, viewer.familyId, ownerId, lock);
  if (owner.id !== current.actingAs) throw new ListError("forbidden");
  return owner;
}

export function hidesClaims(viewer: Pick<ListViewer, "personId" | "actingAs">, ownerId: string) {
  const owner = ownerId.toLowerCase();
  return owner === viewer.personId.toLowerCase() || owner === viewer.actingAs.toLowerCase();
}
