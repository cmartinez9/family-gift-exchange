import type {ComponentPropsWithoutRef, ElementType, ReactNode} from "react";
import {cn} from "./cn";
import {Icon} from "./icon";

/**
 * The yarn block. The colour says what the card is, and the words always say it too:
 * info (yarn white) for everything else, next (gold) for the one thing to do now — at most one per screen —,
 * mine (pine) for yours or only-you, taken (oat rose) for someone else is getting it.
 * No border, no shadow, no edge band.
 */
export type CardTone = "info" | "next" | "mine" | "taken";

const PADDING = {
  card: {info: "p-5", next: "px-5 pt-[18px] pb-5", mine: "py-[18px] pr-[18px] pl-5", taken: "p-5"},
  item: {info: "p-4", next: "p-4", mine: "p-4", taken: "p-4"},
} as const;

type CardProps<T extends ElementType> = {
  tone?: CardTone;
  /** "item" is a gift on a list: 28px corners and 16px padding. */
  size?: "card" | "item";
  /** Drop the default padding (for grouped rows, which set their own). */
  flush?: boolean;
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function Card<T extends ElementType = "div">({tone = "info", size = "card", flush = false, as, className, children, ...rest}: CardProps<T>) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag data-tone={tone} data-size={size} className={cn("fge-card", !flush && PADDING[size][tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** A track: one step darker than its card. For notes, fields, chips and inner rows. */
export function Track({className, children}: {className?: string; children: ReactNode}) {
  return <div className={cn("flex flex-col rounded-track bg-[var(--track)] px-4 py-3", className)}>{children}</div>;
}

/** A note on a track, with the note icon. */
export function NoteTrack({children, className}: {children: ReactNode; className?: string}) {
  return (
    <div className={cn("flex min-h-12 items-center gap-2.5 rounded-[24px] bg-[var(--track)] px-3.5 py-2.5 text-body", className)}>
      <Icon name="note" size={20} strokeWidth={2} />
      <p>{children}</p>
    </div>
  );
}

/** Rows inside a card, iOS inset-grouped: a 1.5px line between rows. */
export function Rows({as: Tag = "div", className, children}: {as?: "div" | "ul" | "ol"; className?: string; children: ReactNode}) {
  return <Tag className={cn("fge-rows flex flex-col", className)}>{children}</Tag>;
}

/**
 * A row in a grouped card: a fixed 48px leading slot, a title and a line under it, and a trailing slot.
 * Pass `as="li"` inside a list.
 */
export function ListRow({lead, title, sub, trail, as: Tag = "div", className}: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; trail?: ReactNode;
  /** "li" inside a list; "span" inside a button or link. */
  as?: "div" | "li" | "span"; className?: string;
}) {
  return (
    <Tag className={cn("flex min-h-16 items-center gap-3.5 py-2", className)}>
      {lead && <span className="flex w-12 shrink-0 justify-center">{lead}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-row-title">{title}</span>
        {sub && <span className="text-body text-[var(--fg-muted)]">{sub}</span>}
      </span>
      {trail && <span className="flex shrink-0 items-center">{trail}</span>}
    </Tag>
  );
}

/** The chevron at the end of a row that opens something. */
export function Chevron() {
  return <Icon name="chevron" size={22} className="text-[var(--fg-muted)]" />;
}

/** A 48px disc that holds one icon (the leading slot of rows, the option rows of the add sheet). */
export function IconDisc({icon, size = 48, iconSize = 22, className}: {
  icon: Parameters<typeof Icon>[0]["name"]; size?: number; iconSize?: number; className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full bg-ink text-snow-white", className)}
      style={{width: size, height: size}}>
      <Icon name={icon} size={iconSize} strokeWidth={2.3} />
    </span>
  );
}

/** "Only you can see this", with the lock. */
export function OnlyYou({children, className}: {children: ReactNode; className?: string}) {
  return (
    <p className={cn("flex items-center gap-2 text-body font-semibold", className)}>
      <Icon name="lock" size={20} strokeWidth={2.3} />
      <span>{children}</span>
    </p>
  );
}

/** A line with a leading icon in a card: facts like sizes and likes. */
export function Fact({icon, children}: {icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode}) {
  return (
    <p className="flex items-center gap-2.5 text-body font-semibold">
      <Icon name={icon} size={22} strokeWidth={2.3} className="text-pine" />
      <span>{children}</span>
    </p>
  );
}
