import type {ReactNode} from "react";
import {Card} from "./card";
import {cn} from "./cn";
import {Icon} from "./icon";
import {STITCH_CELL, StitchedText} from "./knit/stitched-text";
import {AppLink} from "./navigation";

/**
 * The pass: your person, a pine card kept at the top of Home and Family, the way a boarding pass stays
 * on top in a wallet. The name stays knitted; the card says "Only you can see this" and the budget.
 * With `href` the whole card opens your person's page.
 */
export function Pass({name, lead, onlyYou, budget, href, openLabel}: {
  name: string;
  /** "You're giving to" */
  lead: string;
  /** "Only you can see this" */
  onlyYou: string;
  /** "$50" */
  budget?: string;
  href?: string;
  /** Read after the name when the pass is a link: "Open Beto's page". */
  openLabel?: string;
}) {
  const body: ReactNode = (
    <>
      <span className="flex items-start justify-between">
        <span className="flex flex-col gap-2.5">
          <span className="text-body font-semibold text-pale-pine">{lead}</span>
          <StitchedText text={name} cell={STITCH_CELL.pass} />
        </span>
        {href && (
          <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-snow-white text-pine">
            <Icon name="chevron" size={24} strokeWidth={2.6} />
          </span>
        )}
      </span>
      <span className="mt-3.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-body font-semibold whitespace-nowrap">
          <Icon name="lock" size={20} strokeWidth={2.3} />{onlyYou}
        </span>
        {budget && (
          <span className="flex items-center gap-1.5 text-body font-semibold whitespace-nowrap text-pale-pine">
            <Icon name="tag" size={20} strokeWidth={2.3} />{budget}
          </span>
        )}
      </span>
      {href && openLabel && <span className="sr-only">{openLabel}</span>}
    </>
  );
  if (!href) return <Card tone="mine" data-pass="">{body}</Card>;
  return (
    <AppLink href={href} transition="push" className={cn("fge-press block rounded-card")} data-pass="">
      <Card tone="mine" as="span">{body}</Card>
    </AppLink>
  );
}
