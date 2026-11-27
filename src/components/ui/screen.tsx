import {ViewTransition, type ReactNode} from "react";
import {cn} from "./cn";
import {EdgeSwipeBack} from "./motion/edge-swipe";
import {TabRoot, type TabKey} from "./tab-bar";

// enter and exit classes per navigation type; see ui.css
const ENTER = {"fge-push": "fge-push-in", "fge-back": "fge-back-in", "fge-tab": "fge-tab-in", default: "none"};
const EXIT = {"fge-push": "fge-push-out", "fge-back": "fge-back-out", "fge-tab": "fge-tab-out", default: "none"};

/**
 * The page container. Every screen is one phone column on its ground:
 * red on almost every screen, pine only for what only you may see.
 *
 * - `tab` marks a tab root (Home, My list, Family): the shared tab bar shows, and the content stays clear of it.
 * - `back` marks a pushed page: swiping from the left edge goes back to it.
 * - `actions` sit 34px above the bottom, over the home indicator; toasts float above them. At the largest
 *   text size they follow the content instead, so they never cover half the screen.
 *
 * Navigations tagged push, back or tab (see AppLink) animate this container as a view transition.
 */
export function Screen({ground = "red", tab, tabHrefs, back, actions, children, className, label}: {
  ground?: "red" | "pine";
  tab?: TabKey;
  tabHrefs?: Partial<Record<TabKey, string>>;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The main landmark's name, when the page has no h1. */
  label?: string;
}) {
  const page = (
    <main aria-label={label} data-ground={ground} data-screen={tab ? "tab" : back ? "push" : "root"}
      className={cn("fge-screen relative flex min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] flex-col text-snow-white",
        ground === "pine" ? "bg-pine" : "bg-sweater-red", className)}>
      {tab && <TabRoot active={tab} hrefs={tabHrefs} />}
      <div className="flex flex-1 flex-col">{children}</div>
      {actions && (
        <div data-actions="" className={cn("sticky bottom-0 z-10 flex flex-col gap-2 px-edge pt-4 pb-[34px] max-[299px]:static",
          ground === "pine" ? "bg-pine" : "bg-sweater-red")}>
          {actions}
        </div>
      )}
    </main>
  );
  return (
    <ViewTransition enter={ENTER} exit={EXIT} default="none">
      {back ? <EdgeSwipeBack href={back}>{page}</EdgeSwipeBack> : page}
    </ViewTransition>
  );
}
