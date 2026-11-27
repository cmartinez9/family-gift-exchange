import type {ReactNode} from "react";
import {cn} from "./cn";
import {Icon} from "./icon";
import {AppLink} from "./navigation";

/**
 * A corner label: 13px caps, +0.06em. The only label the design keeps is Home's season, beside your
 * avatar, and list counts ("4 THINGS"). Never above a heading.
 */
export function CornerLabel({lines, className}: {lines: readonly string[]; className?: string}) {
  return (
    <p className={cn("flex flex-col text-label uppercase whitespace-nowrap max-[299px]:whitespace-normal", className)}>
      {lines.map((line) => <span key={line}>{line}</span>)}
    </p>
  );
}

/** Home's top row: the season on the left, you on the right. */
export function HomeTop({season, you}: {season: readonly string[]; you: ReactNode}) {
  return (
    // A season word too wide to sit beside you (the largest text size, a long exchange name) moves you
    // under it, still on the right, rather than running under your avatar.
    <div className="flex flex-wrap items-center justify-between gap-3 px-edge pt-2 text-snow-white" data-home-top="">
      <CornerLabel lines={season} className="max-w-full" />
      <span className="ml-auto flex">{you}</span>
    </div>
  );
}

/**
 * The back row of a pushed page: a 48px disc and the parent's name, and optionally a text link on the
 * right, like an iOS navigation bar item ("Something wrong?").
 */
export function BackRow({href, parent, backLabel, right, dark = false}: {
  href: string;
  /** The parent's name: "Family". */
  parent: string;
  /** Read before the parent's name: "Back to". */
  backLabel?: string;
  right?: ReactNode;
  /** On a light ground (a full-screen yarn-white page). */
  dark?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-2 px-4 pt-2 max-[299px]:px-2", dark ? "text-ink" : "text-snow-white")} data-back-row="">
      <AppLink href={href} transition="back" className="fge-press inline-flex min-h-12 items-center gap-2.5 rounded-pill pr-2 max-[299px]:gap-2 max-[299px]:pr-0">
        <span aria-hidden="true" className={cn("inline-flex size-12 items-center justify-center rounded-full", dark ? "bg-card-track" : "bg-on-ground")}>
          <Icon name="back" size={24} strokeWidth={2.5} />
        </span>
        <span className="text-body font-semibold">{backLabel && <span className="sr-only">{backLabel} </span>}{parent}</span>
      </AppLink>
      {right}
    </div>
  );
}

/** A screen's title (36px, one per screen), an optional count on the right, and the sentence under it. */
export function PageTitle({title, lead, count, as: Tag = "h1", className}: {
  title: ReactNode; lead?: ReactNode; count?: string; as?: "h1" | "h2"; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 px-edge pt-4 text-snow-white", className)} data-page-title="">
      {/* at the largest text size the count moves under the title rather than squeezing it */}
      <div className="flex items-end justify-between gap-3 max-[299px]:flex-col max-[299px]:items-start max-[299px]:gap-1">
        <Tag className="max-w-full min-w-0 text-title break-words">{title}</Tag>
        {count && <p className="pb-1.5 text-label uppercase whitespace-nowrap">{count}</p>}
      </div>
      {lead && <p className="text-lead">{lead}</p>}
    </div>
  );
}

/** A heading on the ground ("The rest of the family"), with an optional count. */
export function SectionHeading({title, count, as: Tag = "h2", className}: {
  title: ReactNode; count?: string; as?: "h2" | "h3"; className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between px-edge pt-6 pb-3 text-snow-white max-[299px]:flex-col max-[299px]:items-start max-[299px]:gap-1", className)}>
      <Tag className="text-section max-[299px]:min-w-0 max-[299px]:max-w-full max-[299px]:break-words">{title}</Tag>
      {count && <p className="text-label uppercase whitespace-nowrap">{count}</p>}
    </div>
  );
}
