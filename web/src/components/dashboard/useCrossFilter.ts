"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { ownCross, toggleCross, type CrossPick } from "@/lib/query/cross";
import { useDashboardNav } from "./live";

export interface CrossFilter {
  /** Values picked in this visual, per field. */
  own: Record<string, string[]>;
  /** Picks (or unpicks) an item; `additive` = Ctrl/Cmd/Shift held. */
  pick: (picks: readonly CrossPick[], additive: boolean) => void;
  /** The page is recalculating after a click. */
  pending: boolean;
}

/** Cross-filter state of one visual, kept in the URL (see lib/query/cross). */
export function useCrossFilter(visualId: string, fields: readonly string[]): CrossFilter {
  const params = useSearchParams();
  const { go, pending } = useDashboardNav();
  const fieldsKey = fields.join(",");

  const own = useMemo(
    () => ownCross(new URLSearchParams(params.toString()), visualId, fieldsKey ? fieldsKey.split(",") : []),
    [params, visualId, fieldsKey],
  );

  const pick = useCallback(
    (picks: readonly CrossPick[], additive: boolean): void => {
      go(toggleCross(new URLSearchParams(params.toString()), visualId, picks, additive));
    },
    [params, go, visualId],
  );

  return { own, pick, pending };
}

/** Ctrl, Cmd or Shift held: the click adds to the selection instead of replacing it. */
export function isAdditive(e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } | undefined): boolean {
  return Boolean(e && (e.ctrlKey || e.metaKey || e.shiftKey));
}
