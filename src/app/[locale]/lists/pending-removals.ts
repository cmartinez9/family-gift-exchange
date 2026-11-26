"use client";

import {useEffect, useSyncExternalStore} from "react";
import {DURATION} from "@/components/ui/motion/easing";
import {dismissToast, toast} from "@/components/ui/toast";
import type {Feedback} from "./action-types";
import {removeItem} from "./actions";

type Removal = {timer: number; state: "undo" | "saving" | "saved"};
const pending = new Map<string, Map<string, Removal>>();
const empty: ReadonlySet<string> = new Set();
let hidden: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const listeners = new Set<() => void>();

function emit() {
  hidden = new Map([...pending].map(([ownerId, items]) => [ownerId, new Set(items.keys())]));
  listeners.forEach((listener) => listener());
}

function restore(ownerId: string, itemId: string) {
  const items = pending.get(ownerId);
  items?.delete(itemId);
  if (!items?.size) pending.delete(ownerId);
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

export function removeWithUndo(ownerId: string, itemId: string, message: string, errorMessage: (error: Feedback) => string) {
  const items = pending.get(ownerId) ?? new Map<string, Removal>();
  if (items.has(itemId)) return;
  const removal: Removal = {timer: 0, state: "undo"};
  items.set(itemId, removal);
  pending.set(ownerId, items);
  removal.timer = window.setTimeout(async () => {
    removal.state = "saving";
    dismissToast(toastId);
    let error: Feedback | undefined;
    try {
      error = (await removeItem(ownerId, itemId)).error;
    } catch {
      error = "could-not-save";
    }
    if (error) {
      restore(ownerId, itemId);
      toast({message: errorMessage(error), icon: "alert"});
    } else {
      removal.state = "saved";
      emit();
    }
  }, DURATION.toastStayUndo + 300);
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
