import type {ReactNode} from "react";
import {Card, IconDisc, stackRow, stackWords, type CardTone} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon, type IconName} from "@/components/ui/icon";

/**
 * A row on a yarn block that opens in place: for the organizer's less common tools (test the rules,
 * close the exchange). The summary is the row's only text, so it reads as one name.
 */
export function Disclosure({summary, icon, children, open, tone = "info", className, danger = false}: {
  summary: string; icon?: IconName; children: ReactNode; open?: boolean; tone?: CardTone; className?: string;
  /** For what cannot be undone: the disc is the danger colour. */
  danger?: boolean;
}) {
  return (
    <Card as="details" tone={tone} flush open={open} className={cn("group px-5", className)}>
      <summary className={cn("fge-press flex min-h-[72px] cursor-pointer list-none items-center gap-3.5 py-3 [&::-webkit-details-marker]:hidden", icon && stackRow)}>
        {icon && <IconDisc icon={icon} className={danger ? "bg-danger" : undefined} />}
        <span className={cn("min-w-0 flex-1 text-row-title", icon && stackWords)}>{summary}</span>
        <Icon name="chevron" size={22} className="text-[var(--fg-muted)] transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-3 pb-5">{children}</div>
    </Card>
  );
}
