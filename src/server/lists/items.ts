import "server-only";
import {and, asc, desc, eq, inArray, sql} from "drizzle-orm";
import {withFamily} from "../db/client";
import type {FamilyTransaction} from "../db/database";
import {items} from "../db/schema";
import {ListError, requireListActor, requireListEditor, requireListPerson, type ListViewer} from "./access";
import {clearItemClaim, getClaimDestination} from "./claims";
import {listItemsScope, requireListItem} from "./item-records";
import {listEvents, type ListEvents} from "./list-events";
import {linkPreviewFromUrl, resolveLinkPreview, type LinkPreview} from "./link-preview";
import {safeStoredLink} from "./link-preview/url";
import {discardListPhoto, photoStorage, processListPhoto, storeListPhoto, type ListPhotoStorage} from "./photo-storage";
import {itemKinds, listText, NOTE_LIMIT, PICTURE_WAIT_MS, TITLE_LIMIT, usdAmount, type ItemKind} from "./validation";

type Item = typeof items.$inferSelect;
type ItemValues = Partial<typeof items.$inferInsert>;
type WritableFields = {title?: string; note?: string; price?: string; starred?: boolean};
type ItemInput = WritableFields & {link?: string; upload?: Buffer};
type AddItemInput = ItemInput & {kind: ItemKind};
type ItemServices = {
  events?: ListEvents;
  storage?: ListPhotoStorage;
  /** Reads a link's store page; a preview read ahead of time can stand in for it. */
  resolve?: typeof resolveLinkPreview;
  /** Reads what a link says on its own, before its page loads. */
  readLink?: typeof linkPreviewFromUrl;
  /**
   * Runs work after the response (Next.js `after()`). Given one, a new link saves at once from the link
   * alone, and its store page is read afterwards.
   */
  later?: (task: () => Promise<void>) => void;
};
type PreviewFields = {
  title?: string;
  price?: string;
  icon?: string;
  productId?: string;
  brand?: string;
  iconKey?: string;
  imageSource?: "upload" | "preview";
  /** When a link saved before its page was read; cleared once the page has been read or given up on. */
  pending?: number;
  titleEdited?: boolean;
  priceEdited?: boolean;
};

function readPreview(value: Item["preview"]): PreviewFields {
  return {
    title: typeof value?.title === "string" ? value.title : undefined,
    price: typeof value?.price === "string" ? value.price : undefined,
    icon: typeof value?.icon === "string" ? value.icon : undefined,
    productId: typeof value?.productId === "string" ? value.productId : undefined,
    brand: typeof value?.brand === "string" ? value.brand : undefined,
    iconKey: typeof value?.iconKey === "string" ? value.iconKey : undefined,
    imageSource: value?.imageSource === "upload" || value?.imageSource === "preview" ? value.imageSource : undefined,
    pending: typeof value?.pending === "number" ? value.pending : undefined,
    titleEdited: value?.titleEdited === true,
    priceEdited: value?.priceEdited === true,
  };
}

export function projectItem(item: Item, now = Date.now()) {
  const preview = readPreview(item.preview);
  const pending = preview.pending;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    note: item.note,
    url: safeStoredLink(item.url),
    price: item.price,
    store: item.store,
    starred: item.starred,
    hasPhoto: Boolean(item.imageKey),
    updatedAt: item.updatedAt,
    hasIcon: Boolean(preview.iconKey),
    icon: preview.icon,
    /** The store's page is still being read for this new link's picture, title and price. */
    pictureComing: pending !== undefined && now - pending < PICTURE_WAIT_MS,
  };
}

function writableFields(input: WritableFields) {
  const title = input.title === undefined ? undefined : listText(input.title, TITLE_LIMIT);
  const note = input.note === undefined ? undefined : listText(input.note, NOTE_LIMIT);
  const price = input.price === undefined ? undefined : usdAmount(input.price);
  if ((input.title !== undefined && title === undefined) ||
    (input.note !== undefined && note === undefined) ||
    (input.price !== undefined && price === undefined)) {
    throw new ListError("invalid-item");
  }
  return {title, note: note === undefined ? undefined : note || null, price, starred: input.starred};
}

class ItemPhotos {
  private storage?: ListPhotoStorage;
  private created: string[] = [];

  constructor(private readonly familyId: string, storage?: ListPhotoStorage) {
    this.storage = storage;
  }

  private getStore() {
    return this.storage ??= photoStorage();
  }

  async save(bytes: Buffer | undefined, required = false) {
    if (!bytes) return undefined;
    try {
      const key = await storeListPhoto(this.getStore(), this.familyId, bytes);
      this.created.push(key);
      return key;
    } catch (error) {
      if (required) {
        if (error instanceof ListError) throw error;
        throw new ListError("storage-unavailable");
      }
    }
  }

  async cleanup(keepKeys: (string | null | undefined)[], oldKeys: (string | null | undefined)[] = []) {
    const trash = new Set([...this.created, ...oldKeys].filter(
      (key): key is string => Boolean(key?.startsWith(`wishlist/${this.familyId}/`)) && !keepKeys.includes(key),
    ));
    if (!trash.size) return;
    try {
      const storage = this.getStore();
      await Promise.all(Array.from(trash, (key) => discardListPhoto(storage, key)));
    } catch {
      console.warn("Wishlist photo storage unavailable for cleanup");
    }
  }
}

async function prepareItemPhoto(photos: ItemPhotos, upload?: Buffer, preview?: LinkPreview) {
  if (upload) return photos.save(await processListPhoto(upload), true);
  return photos.save(preview?.image);
}

function previewFields(preview: LinkPreview, iconKey?: string, imageSource?: PreviewFields["imageSource"]) {
  return {
    title: preview.title ?? undefined, price: preview.price ?? undefined,
    icon: preview.icon, brand: preview.brand, productId: preview.productId, iconKey, imageSource,
  };
}

export async function addListItem(viewer: ListViewer, ownerId: string, input: AddItemInput, services: ItemServices = {}) {
  if (!itemKinds.includes(input.kind) || (input.kind === "link" && !input.link) ||
    (input.kind === "photo" && !input.upload) || (input.kind !== "link" && input.link !== undefined) ||
    (input.kind === "note" && input.upload)) {
    throw new ListError("invalid-item");
  }
  const fields = writableFields(input);
  if (!fields.title && input.kind !== "link") throw new ListError("invalid-item");
  await withFamily(viewer.familyId, (tx) => requireListEditor(tx, viewer, ownerId));

  const photos = new ItemPhotos(viewer.familyId, services.storage);
  let usedKeys: (string | undefined)[] = [];
  const link = input.link;
  const later = link ? services.later : undefined;
  try {
    const read = later ? services.readLink ?? linkPreviewFromUrl : services.resolve ?? resolveLinkPreview;
    const preview = link ? await read(link) : undefined;
    const imageKey = await prepareItemPhoto(photos, input.upload, preview);
    const iconKey = imageKey ? undefined : await photos.save(preview?.favicon);
    const result = await withFamily(viewer.familyId, async (tx) => {
      // Serializes additions and ordering changes for this owner's list.
      await requireListEditor(tx, viewer, ownerId, true);
      const scope = listItemsScope(viewer.familyId, ownerId);
      const [last] = await tx.select({position: items.position}).from(items)
        .where(scope).orderBy(desc(items.position)).limit(1);
      const [item] = await tx.insert(items).values({
        familyId: viewer.familyId, ownerId, kind: input.kind,
        title: fields.title || preview?.title || preview?.store.slice(0, TITLE_LIMIT) || "",
        note: fields.note, starred: fields.starred,
        price: fields.price === undefined ? preview?.price : fields.price,
        url: preview?.url, store: preview?.store, imageKey, position: (last?.position ?? -1) + 1,
        preview: preview && {
          ...previewFields(preview, iconKey, input.upload ? "upload" : imageKey ? "preview" : undefined),
          ...(later && {pending: Date.now(), titleEdited: Boolean(fields.title), priceEdited: fields.price !== undefined}),
        },
      }).returning();
      return projectItem(item);
    });
    usedKeys = [imageKey, iconKey];
    if (later && link) later(() => fillLinkPreview(viewer, ownerId, result.id, link, services));
    return result;
  } finally {
    await photos.cleanup(usedKeys);
  }
}

async function notifyClaimChange(tx: FamilyTransaction, item: Item, events: ListEvents, change: "edited" | "deleted") {
  const personId = await getClaimDestination(tx, item.familyId, item.id);
  if (!personId) return;
  await events.claimedItemChanged(tx, {
    familyId: item.familyId, personId, itemId: item.id, title: item.title, change,
  });
}

async function saveChanges(tx: FamilyTransaction, item: Item, changes: ItemValues, events: ListEvents, notify = true) {
  const [updated] = await tx.update(items).set({...changes, updatedAt: new Date()}).where(
    and(eq(items.familyId, item.familyId), eq(items.id, item.id)),
  ).returning();
  const changed = updated.title !== item.title || updated.note !== item.note || updated.url !== item.url ||
    updated.imageKey !== item.imageKey || updated.price !== item.price || updated.starred !== item.starred;
  if (changed && notify) await notifyClaimChange(tx, item, events, "edited");
  return updated;
}

/**
 * `refresh` reads the item's link again. `fill` is the read a new link's save left for later: it changes
 * only an item still waiting on it, starting from the words first pasted, and tells no one (the item's
 * first details are not an edit).
 */
type ChangeMode = {refresh: false} | {refresh: true; fill?: {source: string}};

async function changeListItem(
  viewer: ListViewer, ownerId: string, itemId: string, input: ItemInput, services: ItemServices, mode: ChangeMode,
) {
  const refresh = mode.refresh;
  const fill = mode.refresh ? mode.fill : undefined;
  const fields = writableFields(input);
  if (fields.title === "") throw new ListError("invalid-item");
  const before = await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId);
    const item = await requireListItem(tx, viewer.familyId, itemId);
    if (item.ownerId !== ownerId) throw new ListError("not-found");
    return item;
  });
  const newLink = input.link?.trim() === before.url ? undefined : input.link;
  if (((refresh || newLink !== undefined) && before.kind !== "link") ||
    (input.upload && before.kind === "note") || (refresh && !before.url)) {
    throw new ListError("invalid-item");
  }
  if (fill && readPreview(before.preview).pending === undefined) return projectItem(before);

  const photos = new ItemPhotos(viewer.familyId, services.storage);
  let usedKeys: (string | null | undefined)[] = [];
  let replacedKeys: (string | null | undefined)[] = [];
  try {
    const link = fill ? fill.source : refresh ? before.url : newLink;
    const preview = link !== undefined && link !== null
      ? await (services.resolve ?? resolveLinkPreview)(link)
      : undefined;
    const imageKey = await prepareItemPhoto(photos, input.upload, preview);
    const iconKey = imageKey ? undefined : await photos.save(preview?.favicon);
    const change = await withFamily(viewer.familyId, async (tx) => {
      await requireListEditor(tx, viewer, ownerId, true);
      const item = await requireListItem(tx, viewer.familyId, itemId, true);
      if (item.ownerId !== ownerId) throw new ListError("not-found");
      if (preview && item.url !== before.url) throw new ListError("item-changed");
      const oldPreview = readPreview(item.preview);
      if (fill && oldPreview.pending === undefined) return {item: projectItem(item), kept: [], old: []};
      const keepUploaded = oldPreview.imageSource === "upload" && !input.upload;
      const nextImageKey = keepUploaded ? item.imageKey : imageKey ?? (newLink === undefined ? item.imageKey : null);
      const imageSource = input.upload || keepUploaded ? "upload" : nextImageKey ? "preview" : undefined;
      const nextIconKey = nextImageKey ? undefined : iconKey ?? (newLink === undefined ? oldPreview.iconKey : undefined);
      // Preserve ownership markers on every preview replacement: a title matching the store default
      // or an intentionally cleared price must stay protected through deferred fills and later refreshes.
      const nextPreview = item.kind === "link" ? {
        ...(preview ? previewFields({
          ...preview,
          price: preview.price ?? (refresh ? oldPreview.price ?? null : null),
        }) : oldPreview),
        iconKey: nextIconKey,
        imageSource,
        titleEdited: oldPreview.titleEdited || (oldPreview.pending !== undefined && fields.title !== undefined),
        priceEdited: oldPreview.priceEdited || (oldPreview.pending !== undefined && fields.price !== undefined),
      } : undefined;
      const suggestedTitle = !oldPreview.titleEdited && (item.title === oldPreview.title || item.title === item.store)
        ? preview?.title : undefined;
      const suggestedPrice = !oldPreview.priceEdited && item.price === (oldPreview.price ?? null)
        ? preview?.price ?? undefined : undefined;
      const updated = await saveChanges(tx, item, {
        ...fields,
        title: fields.title ?? suggestedTitle ?? undefined,
        price: fields.price === undefined ? suggestedPrice : fields.price,
        url: preview?.url,
        store: preview?.store,
        imageKey: nextImageKey,
        preview: nextPreview,
      }, services.events ?? listEvents, !fill);
      return {
        item: projectItem(updated),
        kept: [updated.imageKey, readPreview(updated.preview).iconKey],
        old: [item.imageKey, oldPreview.iconKey],
      };
    });
    usedKeys = change.kept;
    replacedKeys = change.old;
    return change.item;
  } finally {
    await photos.cleanup(usedKeys, replacedKeys);
  }
}

export function editListItem(viewer: ListViewer, ownerId: string, itemId: string, input: ItemInput, services?: ItemServices) {
  return changeListItem(viewer, ownerId, itemId, input, services ?? {}, {refresh: false});
}

export function refreshListItem(viewer: ListViewer, ownerId: string, itemId: string, services?: ItemServices) {
  return changeListItem(viewer, ownerId, itemId, {}, services ?? {}, {refresh: true});
}

/**
 * Reads the store's page for a link saved before it loaded, then fills in its generated details. A
 * failed read leaves the item as saved, including any uploaded photo, for the owner to refresh later.
 */
export async function fillLinkPreview(
  viewer: ListViewer, ownerId: string, itemId: string, source: string, services: ItemServices = {},
) {
  try {
    await changeListItem(viewer, ownerId, itemId, {}, {...services, later: undefined}, {refresh: true, fill: {source}});
  } catch (error) {
    if (!(error instanceof ListError)) {
      console.warn("Could not finish a link's picture", error instanceof Error ? error.name : "Unknown error");
    }
    // Someone who may no longer edit the list leaves the item alone; its wait runs out on its own.
    if (error instanceof ListError && (error.code === "forbidden" || error.code === "not-found")) return;
    try {
      await withFamily(viewer.familyId, (tx) => tx.update(items).set({preview: sql`${items.preview} - 'pending'`})
        .where(and(eq(items.familyId, viewer.familyId), eq(items.id, itemId), sql`${items.preview} ->> 'pending' is not null`)));
    } catch {
      // The wait runs out on its own (PICTURE_WAIT_MS), so the item still settles without a picture.
    }
  }
}

export async function removeListItem(viewer: ListViewer, ownerId: string, itemId: string, services: ItemServices = {}) {
  const keys = await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId, true);
    const item = await requireListItem(tx, viewer.familyId, itemId, true);
    if (item.ownerId !== ownerId) throw new ListError("not-found");
    await notifyClaimChange(tx, item, services.events ?? listEvents, "deleted");
    await tx.update(items).set({archivedAt: new Date(), imageKey: null, preview: null}).where(and(
      eq(items.familyId, viewer.familyId), eq(items.id, itemId),
    ));
    await clearItemClaim(tx, viewer.familyId, itemId);
    return [item.imageKey, readPreview(item.preview).iconKey];
  });
  await new ItemPhotos(viewer.familyId, services.storage).cleanup([], keys);
}

export async function moveListItem(viewer: ListViewer, ownerId: string, itemId: string, direction: "up" | "down") {
  await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId, true);
    const order = await tx.select({id: items.id, position: items.position}).from(items)
      .where(listItemsScope(viewer.familyId, ownerId)).orderBy(asc(items.position), asc(items.id));
    const index = order.findIndex((item) => item.id === itemId);
    if (index < 0) throw new ListError("not-found");
    const neighbor = index + (direction === "up" ? -1 : 1);
    if (neighbor < 0 || neighbor >= order.length) return;
    [order[index], order[neighbor]] = [order[neighbor], order[index]];
    const changes = order.flatMap((item, position) => position === item.position ? [] : [{id: item.id, position}]);
    const positions = sql.join(changes.map(({id, position}) => sql`when ${id}::uuid then ${position}::integer`), sql` `);
    await tx.update(items).set({position: sql`case ${items.id} ${positions} end`}).where(and(
      listItemsScope(viewer.familyId, ownerId), inArray(items.id, changes.map(({id}) => id)),
    ));
  });
}

export async function getListPhoto(
  viewer: ListViewer, itemId: string, variant: "photo" | "icon", storage?: ListPhotoStorage,
) {
  const key = await withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const item = await requireListItem(tx, viewer.familyId, itemId);
    await requireListPerson(tx, viewer.familyId, item.ownerId);
    return variant === "photo" ? item.imageKey : readPreview(item.preview).iconKey;
  });
  if (!key?.startsWith(`wishlist/${viewer.familyId}/`)) return null;
  return (storage ?? photoStorage()).get(key);
}
