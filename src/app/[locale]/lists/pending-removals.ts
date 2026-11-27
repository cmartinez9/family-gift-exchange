"use client";

import {useEffect, useSyncExternalStore} from "react";
import {DURATION} from "@/components/ui/motion/easing";
import {dismissToast, toast} from "@/components/ui/toast";
import type {Feedback, FormState} from "./action-types";
import {removeItem} from "./actions";
import {runListAction} from "./client-action";

type Removal = {timer: number; state: "undo" | "saving" | "saved"; save: (keepalive: boolean) => Promise<boolean>};
const pending = new Map<string, Map<string, Removal>>();
const empty: ReadonlySet<string> = new Set();
let hidden: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const listeners = new Set<() => void>();

function flush() {
  for (const items of pending.values()) {
    for (const removal of items.values()) void removal.save(true);
  }
}

function visibilityChanged() {
  if (document.visibilityState === "hidden") flush();
}

export async function commitPendingRemovals(ownerId: string) {
  const results = await Promise.all([...(pending.get(ownerId)?.values() ?? [])].map((removal) => removal.save(false)));
  return results.every(Boolean);
}

function emit() {
  hidden = new Map([...pending].map(([ownerId, items]) => [ownerId, new Set(items.keys())]));
  listeners.forEach((listener) => listener());
}

function restore(ownerId: string, itemId: string) {
  const items = pending.get(ownerId);
  items?.delete(itemId);
  if (!items?.size) pending.delete(ownerId);
  if (!pending.size) {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", visibilityChanged);
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePendingRemovals(ownerId: string, items: readonly {id: string}[]) {
  const snapshot = useSyncExternalStore(subscribe, () => hidden.get(ownerId) ?? empty, () => empty);
  useEffect(() => {
    const removals = pending.get(ownerId);
    if (!removals) return;
    const present = new Set(items.map(({id}) => id));
    for (const [id, removal] of removals) {
      if (removal.state === "saved" && !present.has(id)) restore(ownerId, id);
    }
  }, [ownerId, items, snapshot]);
  return snapshot;
}

/** Keep the item, photo, and claim intact until commit so Undo needs no compensating writes. */
export function removeWithUndo(locale: string, ownerId: string, itemId: string, message: string, errorMessage: (error: Feedback) => string) {
  const items = pending.get(ownerId) ?? new Map<string, Removal>();
  if (items.has(itemId)) return;
  if (!pending.size) {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibilityChanged);
  }
  let saving: Promise<boolean> | undefined;
  const removal: Removal = {
    timer: 0,
    state: "undo",
    save: (keepalive) => saving ??= (async () => {
      window.clearTimeout(removal.timer);
      removal.state = "saving";
      dismissToast(toastId);
      const {error} = await runListAction(async () => {
        if (!keepalive) return removeItem(ownerId, itemId);
        const response = await fetch(`/${locale}/lists/${ownerId}/items/${itemId}/remove`, {method: "POST", keepalive: true});
        if (!response.ok) throw new Error("Removal failed");
        return response.json() as Promise<FormState>;
      });
      if (error) {
        restore(ownerId, itemId);
        toast({message: errorMessage(error), icon: "alert"});
      } else {
        removal.state = "saved";
        emit();
      }
      return !error;
    })(),
  };
  items.set(itemId, removal);
  pending.set(ownerId, items);
  removal.timer = window.setTimeout(() => void removal.save(false), DURATION.toastStayUndo + 300);
  const toastId = toast({
    message,
    icon: "undo",
    undo: () => {
      if (removal.state !== "undo") return;
      window.clearTimeout(removal.timer);
      restore(ownerId, itemId);
    },
  });
  emit();
}
