import type {ReactNode} from "react";
import {cn} from "../cn";

/**
 * Knit-in: cards arriving on a screen rise 14px and fade in 340ms, 60ms apart, capped at five.
 * `variant="home"` is Home's slower entrance: 16px, 380ms, 80ms apart. Wrap a list; each child arrives.
 * `one` makes a single new item arrive on its own. Reduced motion: they are simply there.
 */
export function KnitIn({as: Tag = "div", variant = "list", one = false, className, children}: {
  as?: "div" | "ul" | "ol" | "section"; variant?: "list" | "home"; one?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <Tag className={cn(one ? "fge-arrive-one" : "fge-arrive", className)} data-variant={variant}>
      {children}
    </Tag>
  );
}
