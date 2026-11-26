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
};

type ProjectedItem = {
  id: string; kind: ItemKind; title: string; note: string | null; price: string | null; store: string | null;
  starred: boolean; url: string | null; hasPhoto: boolean; claim?: "mine" | "someone";
};

export function photoPath(locale: string, itemId: string) {
  return `/${locale}/lists/photo/${itemId}/photo`;
}

export function toItemView(item: ProjectedItem, locale: string): ListItemView {
  return {
    id: item.id, kind: item.kind, title: item.title, note: item.note, price: item.price, store: item.store,
    starred: item.starred, url: item.url, photo: item.hasPhoto ? photoPath(locale, item.id) : undefined,
    ...(item.claim ? {claim: item.claim} : {}),
  };
}

/** A link item that came without a picture: the one place a list asks for a photo. */
export function missesPicture(item: Pick<ListItemView, "kind" | "photo">) {
  return item.kind === "link" && !item.photo;
}

/**
 * The item's 72px picture: the photo, the tone-on-tone knit with a camera when a link brought none, or a
 * pencil for something written down.
 */
export function ItemThumb({item, size = 72, camera = false, on = "info"}: {
  item: Pick<ListItemView, "kind" | "photo">; size?: number; camera?: boolean; on?: "info" | "next";
}) {
  if (item.photo) return <ItemPicture src={item.photo} size={size} />;
  if (item.kind === "note") {
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-picture bg-[var(--track,var(--card-track))] text-[var(--fg,var(--color-ink))]"
        style={{width: size, height: size}} data-thumb="note">
        <Icon name="pencil" size={Math.round(size * 0.4)} strokeWidth={2.2} />
      </span>
    );
  }
  return <NoPicture size={size} on={on} camera={camera} />;
}
