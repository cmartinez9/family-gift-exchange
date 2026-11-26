import type {CSSProperties, ReactNode} from "react";
import {Card, NoteTrack, type CardTone} from "./card";
import {cn} from "./cn";
import {Heart, Icon} from "./icon";
import {KnitField, KnitSvg} from "./knit/knit-svg";
import {MOTIFS, leafPair, round2, stitchHeight} from "./knit/knit";

/** The fetched store photo on an 18px-cornered tile. */
export function ItemPicture({src, alt = "", size = 72}: {src: string; alt?: string; size?: number}) {
  return (
    // A store photo of unknown size from the link preview; next/image would need its host allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async"
      className="shrink-0 rounded-picture bg-card-track object-cover" style={{width: size, height: size}} />
  );
}

const NO_PICTURE = {
  info: {base: "#EFE9E6", stitch: "#E2DAD6"},
  next: {base: "#DBA533", stitch: "#D19B2C"},
} as const;

/** No picture yet: tone-on-tone knit with a camera, the way to add one. */
export function NoPicture({size = 72, on = "info", camera = true}: {size?: number; on?: "info" | "next"; camera?: boolean}) {
  const colors = NO_PICTURE[on];
  return (
    <span aria-hidden="true" className="relative block shrink-0 overflow-hidden rounded-picture" style={{width: size, height: size, background: colors.base}}>
      <KnitField stitch={colors.stitch} cell={10} className="absolute inset-0" />
      {camera && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-snow-white text-ink">
            <Icon name="camera" size={22} strokeWidth={2.1} />
          </span>
        </span>
      )}
    </span>
  );
}

/** The picture is on its way: an 8 by 8 knit tile with a slow sweep across it. */
export function LoadingPicture({size = 80}: {size?: number}) {
  const columns = 8, cell = size / columns, h = stitchHeight(cell);
  const stitch = "#E2DAD6";
  const paths: ReactNode[] = [];
  for (let row = 0; row * h < size; row++) {
    for (let column = 0; column < columns; column++) {
      paths.push(<path key={`${row}-${column}`} className="fge-ts" d={leafPair(column * cell, row * h, cell, h)}
        style={{fill: stitch, "--d": (column + row) % 6} as CSSProperties} />);
    }
  }
  return (
    <span aria-hidden="true" className="fge-shimmer block shrink-0 overflow-hidden rounded-picture bg-[#EFE9E6]"
      style={{width: size, height: size, "--stitch": stitch} as CSSProperties}>
      <svg width={size} height={size} viewBox={`0 0 ${round2(size)} ${round2(size)}`} className="block">{paths}</svg>
    </span>
  );
}

/**
 * The budget measure: the price against the budget. Under budget it fills ink and says "of $50"; over,
 * it fills gold and says "Over $50" in gold ink. A heads-up for the giver, never a red alarm.
 */
export function BudgetMeasure({price, budget, underLabel, overLabel}: {
  price: number; budget: number; underLabel: string; overLabel: string;
}) {
  const over = price > budget;
  const fill = over ? 100 : Math.round(Math.min(100, (price / budget) * 100));
  const mark = over ? Math.round((budget / price) * 100) : 98;
  return (
    <span className="flex items-center gap-2.5 pt-1.5" data-budget={over ? "over" : "under"}>
      <span aria-hidden="true" className="relative h-2.5 w-[100px] shrink-0 rounded-[5px] bg-budget-track">
        <span className={cn("block h-2.5 rounded-[5px]", over ? "bg-gold" : "bg-ink")} style={{width: fill}} />
        <span className="absolute -top-1 h-[18px] w-0.5 bg-sweater-red" style={{left: mark}} />
      </span>
      <span className={cn("text-body font-bold whitespace-nowrap", over ? "text-gold-ink" : "text-[var(--fg-muted)]")}>
        {over ? overLabel : underLabel}
      </span>
    </span>
  );
}

/** "Someone is getting this": a gift icon and a muted line. */
export function StatusLine({children, icon = "gift"}: {children: ReactNode; icon?: Parameters<typeof Icon>[0]["name"]}) {
  return (
    <p className="flex items-center gap-2 pt-1 text-body font-semibold text-[var(--fg-muted)]">
      <Icon name={icon} size={20} />
      <span>{children}</span>
    </p>
  );
}

/** "Ana really wants this", with a red heart. */
export function WantsLine({children}: {children: ReactNode}) {
  return (
    <p className="flex items-center gap-1.5 pt-0.5 text-body font-semibold">
      <Heart on size={18} />
      <span>{children}</span>
    </p>
  );
}

/** On a pine card: "You're getting this", and the way to undo it. */
export function MineLine({children, action}: {children: ReactNode; action?: ReactNode}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-1 pt-3">
      <p className="flex items-center gap-2 text-body font-extrabold">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-snow-white text-pine">
          <Icon name="check" size={18} strokeWidth={3} />
        </span>
        {children}
      </p>
      {action}
    </div>
  );
}

/** A knitted tag, the mark of a claim: pine knit, a hole for the strand, a stitched check. */
export function YarnTag({scale = 1}: {scale?: number}) {
  const width = round2(34 * scale), height = round2(44 * scale);
  return (
    <span aria-hidden="true" className="relative block overflow-hidden bg-pine outline-2 outline-yarn-white"
      style={{width, height, borderRadius: `${8 * scale}px ${8 * scale}px ${11 * scale}px ${11 * scale}px`}}>
      <KnitField stitch="var(--color-pine-tone)" cell={6.2 * scale} className="absolute inset-0" />
      <span className="absolute rounded-full bg-snow-white" style={{left: 12 * scale, top: 5 * scale, width: 10 * scale, height: 10 * scale}} />
      <span className="absolute inset-x-0 flex justify-center" style={{top: 19 * scale}}>
        <KnitSvg bitmap={MOTIFS.check} cell={2.8 * scale} colors={{"#": "var(--color-yarn-white)"}} />
      </span>
    </span>
  );
}

/** The tag hanging from a card's top right on its yarn strand: an item someone (you) is getting. */
export function HangingTag({className, style}: {className?: string; style?: CSSProperties}) {
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute -top-2.5 right-[42px] flex flex-col items-center", className)}
      style={{transformOrigin: "50% 0", ...style}}>
      <span className="block h-3.5 w-[2.5px] bg-yarn-white" />
      <span className="block" style={{transform: "rotate(6deg)", transformOrigin: "50% 0"}}><YarnTag /></span>
    </span>
  );
}

/**
 * A gift on a list: a 72px picture, the title, the store and price, then a status, an action, a note or
 * a budget measure. Rose when someone else is getting it, pine when you are.
 */
export function ItemCard({tone = "info", picture, title, titleAs: Title = "h3", store, price, details, heart, note, after, tag = false, as, className}: {
  tone?: CardTone;
  picture: ReactNode;
  title: ReactNode;
  /** The title's heading level, to fit the page's outline. */
  titleAs?: "h2" | "h3" | "h4" | "p";
  store?: ReactNode;
  price?: ReactNode;
  /** Under the store line: a status, a "really wants this" line, an action or a budget measure. */
  details?: ReactNode;
  /** The 48px heart disc on your own items. */
  heart?: ReactNode;
  note?: ReactNode;
  after?: ReactNode;
  /**
   * A claim tag hangs from the top right; the title keeps 52px clear for it.
   * "space" keeps the room without drawing the tag (ClaimCard hangs its own, animated).
   */
  tag?: boolean | "space";
  as?: "div" | "li" | "article";
  className?: string;
}) {
  return (
    <Card tone={tone} size="item" as={as ?? "div"} className={className} data-item="">
      <div className="flex items-start gap-3.5">
        {picture}
        <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", tag && "pr-[52px]")}>
          <Title className="text-item-title">{title}</Title>
          {store && (
            <p className="text-body text-[var(--fg-muted)]">
              {store}{price && <> · <span className="font-bold text-[var(--fg)]">{price}</span></>}
            </p>
          )}
          {details}
        </div>
        {heart}
      </div>
      {note && <NoteTrack className="mt-3">{note}</NoteTrack>}
      {after}
      {tag === true && <HangingTag />}
    </Card>
  );
}

/** Your own item's "Really want this" disc. */
export function HeartToggle({on, label, onToggle}: {on: boolean; label: string; onToggle?: () => void}) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onToggle}
      className="fge-press inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--track)] text-[var(--fg)]">
      <Heart on={on} />
    </button>
  );
}
