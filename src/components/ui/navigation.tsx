import type {ComponentProps} from "react";
import {Link} from "@/i18n/navigation";

/**
 * How a navigation moves:
 * push — going deeper: the page comes in from the right in 380ms, the parent slides 30% left and dims.
 * back — the reverse in 300ms.
 * tab — a 220ms crossfade; tabs never slide.
 * With reduced motion, every one is a 160ms crossfade.
 */
export type PageTransition = "push" | "back" | "tab";

export const TRANSITION_TYPES: Readonly<Record<PageTransition, string[]>> = {
  push: ["fge-push"],
  back: ["fge-back"],
  tab: ["fge-tab"],
};

/** A link that tells the next page how to arrive. */
export function AppLink({transition, ...props}: ComponentProps<typeof Link> & {transition?: PageTransition}) {
  return <Link {...props} transitionTypes={transition ? TRANSITION_TYPES[transition] : props.transitionTypes} />;
}
