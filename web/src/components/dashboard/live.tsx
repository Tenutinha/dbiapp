"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { canonicalSearch } from "@/lib/search-string";
import { useBusySignal } from "./busy";
import type { FilterData, PartAnswer } from "./live-types";
import { planBatches, type PartRequest } from "./live-batch";
import { loadFiltersAction, loadPartsAction } from "./section-actions";

/**
 * A dashboard that answers a click without the page being made again.
 *
 * Picking an item in a visual (or changing a filter) only rewrites the address; nothing is asked of the
 * server for the page itself. Each analysis then asks for its own numbers under the new selection, and only
 * the ones on screen (or about to be) do; the others wait until the reader gets to them. The numbers on
 * screen stay where they are, a little dimmed, until the new ones take their place, and the list of filters
 * is brought up to date last, after the visuals.
 *
 * Without this around it (a shared link, a preview) the dashboard works as before: the address changes
 * through the router and the server answers with the whole page.
 */
interface Live {
  /** The selection in the address now (see canonicalSearch). */
  search: string;
  go: (next: URLSearchParams) => void;
  /** The body of a part of the page (an analysis, or "" for the visuals outside any) under a selection. */
  loadPart: (part: string, search: string) => Promise<PartAnswer>;
  /** The filters and picked items as last answered, and the selection they were answered for. */
  data: FilterData & { search: string };
}

const LiveContext = createContext<Live | null>(null);

/** How long the requests of the parts wait for each other, to go in one call. */
const BATCH_MS = 8;
/** The filters are asked after the visuals (requests go to the server one after the other, in order). */
const FILTERS_AFTER_MS = 40;
/** A refused request asks the server for the page again (its ticket may have expired), no more often than this. */
const RENEW_EVERY_MS = 60_000;

interface DashboardLiveProps {
  ticket: string;
  /** The selection the page was made for, and its filters and picked items. */
  initial: FilterData & { search: string };
  children: React.ReactNode;
}

export function DashboardLive({ ticket, initial, children }: DashboardLiveProps) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const search = useMemo(() => canonicalSearch(new URLSearchParams(params.toString())), [params]);
  const [data, setData] = useState(initial);
  const current = useRef(search);
  useEffect(() => {
    current.current = search;
  }, [search]);

  // The ticket lasts a few hours and a dashboard may stay open longer. A refused request has the page made
  // again: it comes with a fresh ticket, and what failed is then asked again by itself (see LazySection).
  const renewed = useRef(0);
  const renew = useCallback((): void => {
    if (Date.now() - renewed.current < RENEW_EVERY_MS) return;
    renewed.current = Date.now();
    router.refresh();
  }, [router]);

  const go = useCallback((next: URLSearchParams): void => {
    const query = next.toString();
    // The address alone: the page stays as it is, and its parts bring themselves up to date.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [pathname]);

  const queue = useRef<PartRequest[]>([]);
  const timer = useRef<number | null>(null);
  const flush = useCallback((): void => {
    timer.current = null;
    const waiting = queue.current;
    queue.current = [];
    for (const batch of planBatches(waiting)) {
      loadPartsAction(ticket, batch.parts, batch.search).then(
        (answer) => {
          batch.requests.forEach((r, i) => r.resolve(answer.ok ? { ok: true, body: answer.bodies[i] ?? null } : { ok: false }));
          if (!answer.ok) renew();
          // The picked items come with the visuals: their chips need not wait for the list of filters.
          if (answer.ok && current.current === batch.search) setData((d) => (d.search === batch.search ? d : { ...d, cross: answer.cross }));
        },
        () => batch.requests.forEach((r) => r.resolve({ ok: false })),
      );
    }
  }, [ticket, renew]);

  const loadPart = useCallback((part: string, wanted: string): Promise<PartAnswer> => new Promise((resolve) => {
    queue.current.push({ part, search: wanted, resolve });
    timer.current ??= window.setTimeout(flush, BATCH_MS);
  }), [flush]);

  // The filters' options under the new selection, once the visuals have been asked for.
  useEffect(() => {
    if (data.search === search) return;
    let live = true;
    const wait = window.setTimeout(() => {
      loadFiltersAction(ticket, search).then(
        (answer) => {
          if (!live) return;
          if (answer.ok) setData({ filters: answer.filters, cross: answer.cross, search });
          // Asked again when the fresh ticket arrives (it is one of this effect's reasons to run).
          else renew();
        },
        () => undefined,
      );
    }, FILTERS_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [ticket, search, data.search, renew]);

  const value = useMemo<Live>(() => ({ search, go, loadPart, data }), [search, go, loadPart, data]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live | null {
  return useContext(LiveContext);
}

/**
 * How a filter or a picked item gets to the address: at once and without the server in a live dashboard;
 * through the router (the whole page is made again, `pending` meanwhile) anywhere else.
 */
export function useDashboardNav(): { go: (next: URLSearchParams) => void; pending: boolean } {
  const live = useContext(LiveContext);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  useBusySignal(pending);
  const viaRouter = useCallback((next: URLSearchParams): void => {
    const query = next.toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }, [pathname, router]);
  return live ? { go: live.go, pending: false } : { go: viaRouter, pending };
}

/** Whether the numbers of the part of the page this is in are not the current selection's yet. */
const StaleContext = createContext(false);
export const StaleProvider = StaleContext.Provider;
export function useStale(): boolean {
  return useContext(StaleContext);
}
