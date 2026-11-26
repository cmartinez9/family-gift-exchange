"use client";

import {TabBarHost, type TabKey} from "./tab-bar";
import {ToastHost} from "./toast";

/**
 * The parts of the shell that persist across pages: the floating tab bar (shown by tab roots) and the
 * one toast. Rendered once by the shared layout.
 */
export function AppChrome({tabsLabel, tabs, undoLabel}: {
  tabsLabel: string;
  tabs: Readonly<Record<TabKey, {label: string; href: string}>>;
  undoLabel: string;
}) {
  return (
    <>
      <TabBarHost label={tabsLabel} tabs={tabs} />
      <ToastHost undoLabel={undoLabel} />
    </>
  );
}
