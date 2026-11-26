"use client";

import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from "react";
import {cn} from "./cn";
import {Icon, type IconName} from "./icon";
import {DURATION} from "./motion/easing";

export type ToastOptions = {
  message: string;
  /** Undo instead of a confirm, for anything reversible. The toast then stays 5s instead of 2.6s. */
  undo?: () => void;
  /** Gold, beside the message. A check by default; "alert" for no connection. */
  icon?: IconName;
  /** "top" drops in under the status bar (no connection); otherwise it floats above the screen's buttons. */
  placement?: "bottom" | "top";
};

type ToastState = ToastOptions & {id: number};

let current: ToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Shows the one ink toast. A new toast replaces the one showing. */
export function toast(options: ToastOptions | string): number {
  current = {...(typeof options === "string" ? {message: options} : options), id: nextId++};
  emit();
  return current.id;
}

/** Hides the toast (or only the given one). */
export function dismissToast(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Where the toast floats: above the tab bar, above the screen's own bottom actions, or 34px up.
 * It never covers the screen's buttons.
 */
function bottomOffset(): string {
  if (document.body.dataset.tabs === "on") return "calc(112px + var(--safe-bottom))";
  const actions = [...document.querySelectorAll<HTMLElement>("[data-actions]")].find((element) => element.offsetParent !== null);
  if (actions) {
    const top = actions.getBoundingClientRect().top;
    return `${Math.max(34, Math.round(window.innerHeight - top + 10))}px`;
  }
  return "calc(34px + var(--safe-bottom))";
}

/**
 * The one toast: an ink pill, 60px, with a gold icon, an 18px message and an optional gold Undo (48px).
 * It rises 16px in 280ms and stays 2.6s, or 5s with Undo. Render once, in the shared layout.
 */
export function ToastHost({undoLabel}: {undoLabel: string}) {
  const state = useSyncExternalStore(subscribe, () => current, () => null);
  const [shown, setShown] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);
  const [bottom, setBottom] = useState("calc(34px + var(--safe-bottom))");
  const timer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (!state) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the external toast store
      setVisible(false);
      return;
    }
    setShown(state);
    setBottom(bottomOffset());
    setVisible(true);
    timer.current = window.setTimeout(() => dismissToast(state.id), state.undo ? DURATION.toastStayUndo : DURATION.toastStay);
  }, [state]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const top = shown?.placement === "top";
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 mx-auto max-w-[480px] px-4" style={top ? {top: "calc(52px + var(--safe-top))"} : {bottom}}
      data-toast-host="">
      <div role="status" aria-live="polite" aria-atomic="true">
        <div data-show={visible} data-placement={top ? "top" : "bottom"}
          className={cn("fge-toast flex min-h-[60px] items-center gap-3 rounded-[30px] bg-ink py-1.5 pr-1.5 pl-5 text-snow-white")}
          inert={!visible}>
          {shown && <>
            <Icon name={shown.icon ?? "check"} size={22} strokeWidth={2.6} className="text-gold" />
            <p className="flex-1 text-body font-semibold">{shown.message}</p>
            {shown.undo && (
              <button type="button"
                className="fge-press inline-flex h-12 shrink-0 cursor-pointer items-center rounded-pill px-4 text-body font-extrabold text-gold underline underline-offset-4"
                onClick={() => {
                  const undo = shown.undo;
                  dismissToast(shown.id);
                  undo?.();
                }}>
                {undoLabel}
              </button>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}
