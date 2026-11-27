import "server-only";
import {and, eq, isNull, notInArray, sql} from "drizzle-orm";
import {withFamily} from "../../db/client";
import type {FamilyTransaction} from "../../db/database";
import {claims, items, people} from "../../db/schema";
import {
  hidesClaims, ListError, requireListActor, requireListPerson, type ListViewer,
} from "../access";
import {activeItemOwner, listItemsScope, requireListItem} from "../item-records";
import {diffSeen, seenOf, seenVersion, type SeenItem} from "./changes";

export type ClaimMark = "mine" | "someone";
export type ClaimProgress = {bought: boolean; wrapped: boolean};

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
  viewer: ListViewer, itemId: string,
  action: (tx: FamilyTransaction, item: Awaited<ReturnType<typeof requireListItem>>) => Promise<T>,
) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const item = await requireListItem(tx, viewer.familyId, itemId, true);
    await requireListPerson(tx, viewer.familyId, item.ownerId);
    if (hidesClaims(viewer, item.ownerId)) throw new ListError("forbidden");
    return action(tx, item);
  });
}

export async function claimItem(viewer: ListViewer, itemId: string, progress?: ClaimProgress) {
  await withClaimableItem(viewer, itemId, async (tx, item) => {
    const [existing] = await tx.select({mine: sql<boolean>`${claims.claimerId} = ${viewer.actingAs}::uuid`})
      .from(claims).where(itemClaim(viewer.familyId, itemId));
    if (existing?.mine) return;
    if (existing) throw new ListError("already-claimed");
    const now = new Date();
    await tx.insert(claims).values({
      familyId: viewer.familyId, itemId, claimerId: viewer.actingAs, seen: seenOf(item),
      boughtAt: progress?.bought === true ? now : null,
      wrappedAt: progress?.wrapped === true ? now : null,
    });
  });
}

function viewerClaim(viewer: ListViewer, itemId: string) {
  return and(itemClaim(viewer.familyId, itemId), eq(claims.claimerId, viewer.actingAs));
}

export async function undoClaim(viewer: ListViewer, itemId: string) {
  return withClaimableItem(viewer, itemId, async (tx) => {
    const [released] = await tx.delete(claims).where(viewerClaim(viewer, itemId)).returning({
      bought: sql<boolean>`${claims.boughtAt} is not null`,
      wrapped: sql<boolean>`${claims.wrappedAt} is not null`,
    });
    return released;
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

/**
 * "Still getting it": the getter has seen the owner's change. Accepts only the version they were shown,
 * so a second edit in the meantime is not waved through unseen.
 */
export async function acknowledgeItemChange(viewer: ListViewer, itemId: string, version: string) {
  await withClaimableItem(viewer, itemId, async (tx, item) => {
    const current = seenOf(item);
    if (seenVersion(current) !== version) throw new ListError("item-changed");
    const [updated] = await tx.update(claims).set({seen: current})
      .where(viewerClaim(viewer, itemId)).returning({id: claims.id});
    if (!updated) throw new ListError("not-found");
  });
}

const changeColumns = {
  seen: claims.seen, itemNote: items.note, itemUrl: items.url, itemStore: items.store, itemPrice: items.price,
  itemImageKey: items.imageKey,
};

type ChangeColumns = {
  title: string; seen: SeenItem | null; itemNote: string | null; itemUrl: string | null;
  itemStore: string | null; itemPrice: string | null; itemImageKey: string | null;
};

/** Each gift with what its owner changed since you last looked, and the version you are being shown. */
function withChanges<T extends ChangeColumns>({seen, itemNote, itemUrl, itemStore, itemPrice, itemImageKey, ...row}: T) {
  const current = seenOf({
    title: row.title, note: itemNote, url: itemUrl, store: itemStore, price: itemPrice, imageKey: itemImageKey,
  });
  return {...row, changes: diffSeen(seen, current), version: seenVersion(current)};
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
      ...changeColumns,
    }).from(claims).innerJoin(items, and(
      eq(items.familyId, claims.familyId), eq(items.id, claims.itemId), isNull(items.archivedAt),
    )).innerJoin(people, activeItemOwner()).where(and(
      eq(claims.familyId, viewer.familyId), eq(claims.claimerId, viewer.actingAs),
      notInArray(items.ownerId, Array.from(new Set([viewer.personId, viewer.actingAs]))),
    )).orderBy(people.displayName, items.title, items.id);
    return rows.map(withChanges);
  });
}
