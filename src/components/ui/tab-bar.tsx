"use client";

import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from "react";
import {cn} from "./cn";
import {Icon, type IconName} from "./icon";
import {haptic} from "./motion/haptic";
import {AppLink} from "./navigation";

export type TabKey = "home" | "list" | "family";
export type TabItem = {key: TabKey; href: string; label: string; icon: IconName};

const ICONS: Readonly<Record<TabKey, IconName>> = {home: "home", list: "list", family: "family"};

/**
 * The floating pill tab bar: Home, My list, Family. An ink pill, 72px, 16px from each side and 26px
 * from the bottom; the active tab is a white pill that springs across in 340ms. Tabs crossfade.
 * At the largest text size (the phone under 300 CSS pixels wide) each icon stacks over its label.
 */
export function TabBar({items, active, label}: {items: readonly TabItem[]; active: TabKey | null; label: string}) {
  const bar = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{x: number; width: number} | null>(null);
  const [ready, setReady] = useState(false);
  const [pressed, setPressed] = useState<TabKey | null>(null);
  const shown = pressed ?? active;

  useLayoutEffect(() => {
    const measure = () => {
      const tab = bar.current?.querySelector<HTMLElement>(`[data-tab="${shown}"]`);
      setPill(tab ? {x: tab.offsetLeft, width: tab.offsetWidth} : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [shown, items]);

  useEffect(() => {
    // the first position is placed, not sprung
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the route caught up with the press
    setPressed(null);
  }, [active]);

  return (
    <nav ref={bar} aria-label={label} data-ready={ready}
      className="fge-tabbar fixed inset-x-4 bottom-[calc(26px+var(--safe-bottom))] z-30 mx-auto flex h-[72px] max-w-[448px] items-center gap-1 rounded-[36px] bg-ink p-2 max-[299px]:inset-x-2 max-[299px]:h-[88px] max-[299px]:rounded-[44px]">
      <span aria-hidden="true" className="fge-tab-pill absolute top-2 left-0 h-14 rounded-[28px] bg-snow-white max-[299px]:h-[72px] max-[299px]:rounded-[36px]"
        style={pill ? {width: pill.width, transform: `translateX(${pill.x}px)`} : {opacity: 0}} />
      {items.map((item) => {
        const on = item.key === shown;
        return (
          <AppLink key={item.key} href={item.href} transition="tab" data-tab={item.key} aria-current={item.key === active ? "page" : undefined}
            onClick={() => {
              if (item.key === active) return;
              haptic("soft");
              setPressed(item.key);
            }}
            className={cn("fge-tab relative flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[28px] text-tab",
              "max-[299px]:h-[72px] max-[299px]:flex-col max-[299px]:gap-0.5 max-[299px]:rounded-[36px]",
              on ? "font-bold text-ink" : "text-snow-white")}>
            <Icon name={item.icon} size={22} strokeWidth={2.3} />
            <span className="truncate">{item.label}</span>
          </AppLink>
        );
      })}
    </nav>
  );
}

// ---------------- the tab bar lives in the shared layout; tab roots ask for it ----------------

type TabRequest = {owner: symbol; active: TabKey; hrefs?: Partial<Record<TabKey, string>>};
let request: TabRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Rendered by the three tab roots (Home, My list, Family). Shows the persistent tab bar with this tab
 * active, and keeps the screen's content clear of it. Pushed pages render no TabRoot and the bar goes.
 */
export function TabRoot({active, hrefs}: {active: TabKey; hrefs?: Partial<Record<TabKey, string>>}) {
  const hrefKey = JSON.stringify(hrefs ?? {});
  useEffect(() => {
    const owner = Symbol(active);
    request = {owner, active, hrefs: JSON.parse(hrefKey) as TabRequest["hrefs"]};
    document.body.dataset.tabs = "on";
    emit();
    return () => {
      if (request?.owner !== owner) return;
      request = null;
      delete document.body.dataset.tabs;
      emit();
    };
  }, [active, hrefKey]);
  return null;
}

/** The shared layout's tab bar: hidden until a tab root asks for it. */
export function TabBarHost({label, tabs}: {label: string; tabs: Readonly<Record<TabKey, {label: string; href: string}>>}) {
  const current = useSyncExternalStore(subscribe, () => request, () => null);
  if (!current) return null;
  const items: TabItem[] = (Object.keys(ICONS) as TabKey[]).map((key) => ({
    key, icon: ICONS[key], label: tabs[key].label, href: current.hrefs?.[key] ?? tabs[key].href,
  }));
  return <TabBar items={items} active={current.active} label={label} />;
}
