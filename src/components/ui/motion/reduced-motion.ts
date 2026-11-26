"use client";

import {useSyncExternalStore} from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when motion should be reduced: the phone's setting, or `data-motion="reduce"` on <html>
 * (the design gallery's switch, like the prototype's).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.dataset.motion === "reduce" || window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-motion"]});
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
