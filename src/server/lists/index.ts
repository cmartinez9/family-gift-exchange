import "server-only";
import {and, asc, count, eq, isNull} from "drizzle-orm";
import {withFamily} from "../db/client";
import {aboutMe, items, people, sizes} from "../db/schema";
import {hidesClaims, requireListActor, requireListPerson, type ListViewer} from "./access";
import {listClaimMarks, type ClaimMark} from "./claims";
import {listItemsScope} from "./item-records";
import {projectItem} from "./items";
import {isListReady, isSizeKind} from "./validation";

export {ListError} from "./access";
export {getListExchangeCard, setExchangeBudget} from "./budget";
export {addListItem, editListItem, getListPhoto, moveListItem, refreshListItem, removeListItem} from "./items";
export type {ListEvents} from "./list-events";
export {saveAboutField, saveListSize, saveNoClothes} from "./profile";

export async function listFamilyWishlists(viewer: ListViewer) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const members = await tx.select({
      id: people.id, name: people.displayName, noClothes: people.noClothes,
    }).from(people).where(and(eq(people.familyId, viewer.familyId), isNull(people.removedAt)))
      .orderBy(asc(people.displayName), asc(people.id));
    const totals = await tx.select({id: items.ownerId, count: count()}).from(items)
      .where(and(eq(items.familyId, viewer.familyId), isNull(items.archivedAt))).groupBy(items.ownerId);
    const sizesGiven = await tx.select({id: sizes.personId, kind: sizes.kind}).from(sizes)
      .where(eq(sizes.familyId, viewer.familyId));
    const itemCounts = new Map(totals.map((total) => [total.id, total.count]));
    const answered = new Map<string, Set<string>>();
    for (const row of sizesGiven) {
      const set = answered.get(row.id) ?? new Set<string>();
      set.add(row.kind);
      answered.set(row.id, set);
    }
    return members.map((member) => {
      const itemCount = itemCounts.get(member.id) ?? 0;
      return {
        id: member.id, name: member.name, itemCount,
        ready: isListReady(itemCount, member.noClothes, answered.get(member.id) ?? new Set()),
      };
    });
  });
}

type ItemView = ReturnType<typeof projectItem> & {claim?: ClaimMark};

export async function getWishlist(viewer: ListViewer, ownerId: string) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const owner = await requireListPerson(tx, viewer.familyId, ownerId);
    const sizesGiven = (await tx.select({
      kind: sizes.kind, value: sizes.value, updatedAt: sizes.updatedAt,
    }).from(sizes).where(and(eq(sizes.familyId, viewer.familyId), eq(sizes.personId, ownerId))))
      .filter((size) => isSizeKind(size.kind));
    const [profile] = await tx.select({
      likes: aboutMe.likes, dislikes: aboutMe.dislikes, allergies: aboutMe.allergies, colors: aboutMe.colors,
    }).from(aboutMe).where(and(eq(aboutMe.familyId, viewer.familyId), eq(aboutMe.personId, ownerId)));
    const entries = await tx.select().from(items).where(listItemsScope(viewer.familyId, ownerId))
      .orderBy(asc(items.position), asc(items.id));
    const showClaims = !hidesClaims(viewer, owner.id);
    const marks = showClaims ? await listClaimMarks(tx, viewer, owner.id) : undefined;
    return {
      owner: {id: owner.id, name: owner.displayName, noClothes: owner.noClothes},
      canEdit: owner.id === viewer.actingAs,
      canClaim: showClaims,
      ready: isListReady(entries.length, owner.noClothes, new Set(sizesGiven.map(({kind}) => kind))),
      sizes: sizesGiven,
      about: profile ?? {likes: null, dislikes: null, allergies: null, colors: null},
      items: entries.map((item): ItemView => {
        const claim = marks?.get(item.id);
        const projection = projectItem(item);
        return claim ? {...projection, claim} : projection;
      }),
    };
  });
}
