import "server-only";
import {and, eq, isNull} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {items, people} from "../db/schema";
import {isListId, ListError} from "./access";

export function listItemsScope(familyId: string, ownerId: string) {
  return and(eq(items.familyId, familyId), eq(items.ownerId, ownerId), isNull(items.archivedAt));
}

export async function requireListItem(
  tx: FamilyTransaction, familyId: string, itemId: string, lock = false,
) {
  if (!isListId(itemId)) throw new ListError("not-found");
  const query = tx.select().from(items).where(and(
    eq(items.familyId, familyId), eq(items.id, itemId), isNull(items.archivedAt),
  ));
  const [item] = await (lock ? query.for("update") : query);
  if (!item) throw new ListError("not-found");
  return item;
}

export function activeItemOwner() {
  return and(eq(people.familyId, items.familyId), eq(people.id, items.ownerId), isNull(people.removedAt));
}
