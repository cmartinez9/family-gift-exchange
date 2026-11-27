import {Icon} from "@/components/ui/icon";
import {ItemPicture, NoPicture} from "@/components/ui/item-card";
import type {ItemKind} from "@/server/lists/validation";

/** What a list screen needs to draw one item; plain data, so client components can take it. */
export type ListItemView = {
  id: string;
  kind: ItemKind;
  title: string;
  note: string | null;
  price: string | null;
  store: string | null;
  starred: boolean;
  url: string | null;
  /** The stored photo, through the signed-in photo route. */
  photo?: string;
  claim?: "mine" | "someone";
  /** A new link whose picture, title and price are still on their way (4.4). */
  pictureComing?: boolean;
};

type ProjectedItem = {
  id: string; kind: ItemKind; title: string; note: string | null; price: string | null; store: string | null;
  starred: boolean; url: string | null; hasPhoto: boolean; updatedAt: Date; claim?: "mine" | "someone";
  pictureComing?: boolean;
};

export function photoPath(locale: string, itemId: string, updatedAt: Date) {
  return `/${locale}/lists/photo/${itemId}/photo?v=${updatedAt.getTime()}`;
}

export function toItemView(item: ProjectedItem, locale: string): ListItemView {
  return {
    id: item.id, kind: item.kind, title: item.title, note: item.note, price: item.price, store: item.store,
    starred: item.starred, url: item.url, photo: item.hasPhoto ? photoPath(locale, item.id, item.updatedAt) : undefined,
    ...(item.claim ? {claim: item.claim} : {}),
    ...(item.pictureComing ? {pictureComing: true} : {}),
  };
}

/** A link item that came without a picture: the one place a list asks for a photo. */
export function missesPicture(item: Pick<ListItemView, "kind" | "photo" | "pictureComing">) {
  return item.kind === "link" && !item.photo && !item.pictureComing;
}

/**
 * The item's 72px picture: the photo, the tone-on-tone knit with a camera when a link brought none, or a
 * pencil for something written down.
 */
export function ItemThumb({item, camera = false, on = "info"}: {
  item: Pick<ListItemView, "kind" | "photo">; camera?: boolean; on?: "info" | "next";
}) {
  if (item.photo) return <ItemPicture src={item.photo} />;
  if (item.kind === "note") {
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-picture bg-[var(--track,var(--card-track))] text-[var(--fg,var(--color-ink))]"
        style={{width: 72, height: 72}} data-thumb="note">
        <Icon name="pencil" size={29} strokeWidth={2.2} />
      </span>
    );
  }
  return <NoPicture on={on} camera={camera} />;
}
