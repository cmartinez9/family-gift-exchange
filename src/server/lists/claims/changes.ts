import {createHash} from "node:crypto";
import type {ClaimSeen} from "../../db/schema";
import {safeStoredLink} from "../link-preview/url";

/**
 * Comparison baseline stored for the claim's lifetime: captured when the claim is created or the
 * getter successfully acknowledges the displayed version. List reads and owner edits never advance it;
 * differences are computed only for the getter's list. A photo is represented by its storage key, never
 * image data; keeping this baseline does not retain the previous picture.
 */
export type SeenItem = ClaimSeen;

export type ItemChange =
  | {field: "title" | "note" | "price"; before: string | null; after: string | null}
  | {field: "link"; before: string | null; after: string | null; url: string | null}
  | {field: "photo"; hasPhoto: boolean};

export function seenOf(item: SeenItem): SeenItem {
  return {
    title: item.title, note: item.note, url: item.url, store: item.store, price: item.price,
    imageKey: item.imageKey ?? null,
  };
}

/** A short fingerprint of what the getter is shown, so "Still getting it" accepts only what they saw. */
export function seenVersion(seen: SeenItem) {
  return createHash("sha256").update(JSON.stringify([seen.title, seen.note, seen.url, seen.store, seen.price, seen.imageKey ?? null]))
    .digest("base64url").slice(0, 22);
}

const amount = (price: string | null) => price === null ? null : Number(price);

/** Differences from the claim baseline, in display order; a null baseline produces no changes. */
export function diffSeen(seen: SeenItem | null, current: SeenItem): ItemChange[] {
  if (!seen) return [];
  const changes: ItemChange[] = [];
  if (seen.title !== current.title) changes.push({field: "title", before: seen.title, after: current.title});
  if ((seen.note ?? null) !== (current.note ?? null)) changes.push({field: "note", before: seen.note, after: current.note});
  if (amount(seen.price) !== amount(current.price)) changes.push({field: "price", before: seen.price, after: current.price});
  if ((seen.url ?? null) !== (current.url ?? null)) {
    changes.push({
      field: "link", before: seen.store ?? seen.url, after: current.store ?? current.url,
      url: safeStoredLink(current.url) ?? null,
    });
  }
  if (seen.imageKey !== undefined && seen.imageKey !== (current.imageKey ?? null)) {
    changes.push({field: "photo", hasPhoto: Boolean(current.imageKey)});
  }
  return changes;
}
