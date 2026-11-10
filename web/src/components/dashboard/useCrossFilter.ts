"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { ownCross, toggleCross, type CrossPick } from "@/lib/query/cross";
import { useBusySignal } from "./busy";

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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  useBusySignal(pending);
  const fieldsKey = fields.join(",");

  const own = useMemo(
    () => ownCross(new URLSearchParams(params.toString()), visualId, fieldsKey ? fieldsKey.split(",") : []),
    [params, visualId, fieldsKey],
  );

  const pick = useCallback(
    (picks: readonly CrossPick[], additive: boolean): void => {
      const next = toggleCross(new URLSearchParams(params.toString()), visualId, picks, additive);
      const query = next.toString();
      start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [params, pathname, router, visualId],
  );

  return { own, pick, pending };
}

/** Ctrl, Cmd or Shift held: the click adds to the selection instead of replacing it. */
export function isAdditive(e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } | undefined): boolean {
  return Boolean(e && (e.ctrlKey || e.metaKey || e.shiftKey));
}
