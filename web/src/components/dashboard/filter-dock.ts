"use client";

import { useSyncExternalStore } from "react";

/**
 * The filters of the dashboard on screen, shared between the FilterBar (which owns the panel) and the
 * dashboard header (which shows the funnel icon that opens it). While a header is docked, the FilterBar
 * leaves out its floating button and opens the panel under the icon. A tiny store, because the two live
 * in different parts of the page.
 */
export interface FilterDockState {
  /** The dashboard on screen has filters (or picked items) to show. */
  available: boolean;
  open: boolean;
  /** Filters in use plus items picked in the visuals: the badge on the icon. */
  count: number;
  /** A new selection is being computed. */
  pending: boolean;
  /** Headers hosting the icon right now. */
  docks: number;
  /** Where the icon is on screen when the panel was opened from it (the panel opens under it). */
  anchor: { bottom: number; right: number } | null;
}

const INITIAL: FilterDockState = { available: false, open: false, count: 0, pending: false, docks: 0, anchor: null };
let state: FilterDockState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<FilterDockState>): void {
  const next = { ...state, ...patch };
  const changed = (Object.keys(patch) as (keyof FilterDockState)[]).some((k) => next[k] !== state[k]);
  if (!changed) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export const filterDock = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: (): FilterDockState => state,
  /** A header hosts the icon while mounted; returns the release. */
  dock(): () => void {
    set({ docks: state.docks + 1 });
    return () => set({ docks: state.docks - 1 });
  },
  /** What the FilterBar has to show. */
  publish(patch: Pick<FilterDockState, "available" | "count" | "pending">): void {
    set(patch);
  },
  /** The icon was clicked: open (under it) or close the panel. */
  toggle(icon: DOMRect): void {
    // clientWidth leaves the scrollbar out, as "right" of a fixed element does.
    set({ open: !state.open, anchor: { bottom: icon.bottom, right: document.documentElement.clientWidth - icon.right } });
  },
  setOpen(open: boolean): void {
    set({ open });
  },
};

/** The shared state, re-rendering on every change. */
export function useFilterDock(): FilterDockState {
  return useSyncExternalStore(filterDock.subscribe, filterDock.get, () => INITIAL);
}
