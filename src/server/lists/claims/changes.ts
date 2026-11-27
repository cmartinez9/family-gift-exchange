import {createHash} from "node:crypto";
import type {ClaimSeen} from "../../db/schema";
import {safeStoredLink} from "../link-preview/url";

/**
 * What the person getting an item last saw of it: kept on their claim when they mark it and each time
 * they say "Still getting it", and gone with the claim. The owner's edit never touches it, so editing
 * reads and writes exactly the same whether or not anyone is getting the item; the difference is worked
 * out only when the getter opens their own list.
 */
export type SeenItem = ClaimSeen;

type ItemFields = {title: string; note: string | null; url: string | null; store: string | null; price: string | null};

export type ItemChange =
  | {field: "title" | "note" | "price"; before: string | null; after: string | null}
  | {field: "link"; before: string | null; after: string | null; url: string | null};

export function seenOf(item: ItemFields): SeenItem {
  return {title: item.title, note: item.note, url: item.url, store: item.store, price: item.price};
}

/** A short fingerprint of what the getter is shown, so "Still getting it" accepts only what they saw. */
export function seenVersion(seen: SeenItem) {
  return createHash("sha256").update(JSON.stringify([seen.title, seen.note, seen.url, seen.store, seen.price]))
    .digest("base64url").slice(0, 22);
}

const amount = (price: string | null) => price === null ? null : Number(price);

/** The fields the owner changed since the getter last looked, in the order the card shows them. */
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
  return changes;
}
