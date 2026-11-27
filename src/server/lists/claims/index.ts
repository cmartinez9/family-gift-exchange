import "server-only";
import {and, eq, isNull, notInArray, sql} from "drizzle-orm";
import {withFamily} from "../../db/client";
import type {FamilyTransaction} from "../../db/database";
import {claims, items, people} from "../../db/schema";
import {
  hidesClaims, ListError, requireListActor, requireListPerson, type ListViewer,
} from "../access";
import {activeItemOwner, listItemsScope, requireListItem} from "../item-records";

export type ClaimMark = "mine" | "someone";

export async function listClaimMarks(tx: FamilyTransaction, viewer: ListViewer, ownerId: string) {
  if (hidesClaims(viewer, ownerId)) return new Map<string, ClaimMark>();
  const rows = await tx.select({
    itemId: items.id,
    mine: sql<boolean>`${claims.claimerId} = ${viewer.actingAs}::uuid`,
  }).from(claims).innerJoin(items, and(
    eq(claims.familyId, items.familyId), eq(claims.itemId, items.id),
  )).where(and(eq(claims.familyId, viewer.familyId), listItemsScope(viewer.familyId, ownerId)));

  return new Map<string, ClaimMark>(rows.map(({itemId, mine}) => [itemId, mine ? "mine" : "someone"]));
}

function itemClaim(familyId: string, itemId: string) {
  return and(eq(claims.familyId, familyId), eq(claims.itemId, itemId));
}

export async function getClaimDestination(tx: FamilyTransaction, familyId: string, itemId: string) {
  const [claim] = await tx.select({personId: claims.claimerId}).from(claims)
    .innerJoin(people, and(eq(claims.familyId, people.familyId), eq(claims.claimerId, people.id)))
    .where(and(itemClaim(familyId, itemId), isNull(people.removedAt)));
  return claim?.personId;
}

export async function clearItemClaim(tx: FamilyTransaction, familyId: string, itemId: string) {
  await tx.delete(claims).where(itemClaim(familyId, itemId));
}

async function withClaimableItem<T>(
  viewer: ListViewer, itemId: string, action: (tx: FamilyTransaction) => Promise<T>,
) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const item = await requireListItem(tx, viewer.familyId, itemId, true);
    await requireListPerson(tx, viewer.familyId, item.ownerId);
    if (hidesClaims(viewer, item.ownerId)) throw new ListError("forbidden");
    return action(tx);
  });
}

export async function claimItem(viewer: ListViewer, itemId: string) {
  await withClaimableItem(viewer, itemId, async (tx) => {
    const [existing] = await tx.select({mine: sql<boolean>`${claims.claimerId} = ${viewer.actingAs}::uuid`})
      .from(claims).where(itemClaim(viewer.familyId, itemId));
    if (existing?.mine) return;
    if (existing) throw new ListError("already-claimed");
    await tx.insert(claims).values({familyId: viewer.familyId, itemId, claimerId: viewer.actingAs});
  });
}

function viewerClaim(viewer: ListViewer, itemId: string) {
  return and(itemClaim(viewer.familyId, itemId), eq(claims.claimerId, viewer.actingAs));
}

export async function undoClaim(viewer: ListViewer, itemId: string) {
  await withClaimableItem(viewer, itemId, async (tx) => {
    await tx.delete(claims).where(viewerClaim(viewer, itemId));
  });
}

export async function setClaimTick(
  viewer: ListViewer, itemId: string, field: "bought" | "wrapped", checked: boolean,
) {
  await withClaimableItem(viewer, itemId, async (tx) => {
    const time = checked ? new Date() : null;
    const [updated] = await tx.update(claims)
      .set(field === "bought" ? {boughtAt: time} : {wrappedAt: time})
      .where(viewerClaim(viewer, itemId)).returning({id: claims.id});
    if (!updated) throw new ListError("not-found");
  });
}

export async function getGettingList(viewer: ListViewer) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const rows = await tx.select({
      itemId: items.id, title: items.title, ownerId: items.ownerId, ownerName: people.displayName,
      kind: items.kind, price: items.price, store: items.store, hasPhoto: sql<boolean>`${items.imageKey} is not null`,
      updatedAt: items.updatedAt,
      bought: sql<boolean>`${claims.boughtAt} is not null`,
      wrapped: sql<boolean>`${claims.wrappedAt} is not null`,
    }).from(claims).innerJoin(items, and(
      eq(items.familyId, claims.familyId), eq(items.id, claims.itemId), isNull(items.archivedAt),
    )).innerJoin(people, activeItemOwner()).where(and(
      eq(claims.familyId, viewer.familyId), eq(claims.claimerId, viewer.actingAs),
      notInArray(items.ownerId, Array.from(new Set([viewer.personId, viewer.actingAs]))),
    )).orderBy(people.displayName, items.title, items.id);
    return rows;
  });
}
