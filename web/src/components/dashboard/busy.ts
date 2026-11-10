"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * "The dashboard is recalculating": raised by whatever started it (a filter, an item picked in a visual)
 * and read by every visual card, which shows a skeleton until the new numbers arrive. A tiny store
 * instead of a context because the starters and the cards sit in different branches of a server tree.
 */
let pendingCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells the cards that a recalculation started by this component is under way. */
export function useBusySignal(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    pendingCount += 1;
    emit();
    return () => {
      pendingCount -= 1;
      emit();
    };
  }, [pending]);
}

/** Whether any recalculation is under way. */
export function useBusy(): boolean {
  return useSyncExternalStore(subscribe, () => pendingCount > 0, () => false);
}
