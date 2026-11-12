"use client";

import { useEffect, useRef, useState } from "react";

export interface StripPage {
  anchor: string;
  title: string;
}

/** Classes of a section that is one page of the strip (pb: room for the cards' shadow, which the strip clips). */
export const PAGE_CLASS = "w-full shrink-0 snap-start snap-always scroll-mt-24 px-px pb-2";

/** Marks the strip, so the sidebar can tell which page is in it (DashboardOutline). */
export const STRIP_ATTR = "data-page-strip";

/** The pages of the strip, in order: its own sections (a lazy one also leaves a marker beside it). */
function pagesOf(strip: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>(":scope > section"));
}

/** The page whose left edge is nearest to where the strip is scrolled. */
function nearest(strip: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const page of pagesOf(strip)) {
    const d = Math.abs(page.offsetLeft - strip.scrollLeft);
    if (d < distance) [best, distance] = [page, d];
  }
  return best;
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The analyses of a dashboard as pages side by side, turned sideways like the pages of a report: tabs
 * above, the summary in the sidebar (its links scroll the strip), a swipe or the arrow keys. The strip
 * is as tall as the page on screen, so a short page leaves no gap under it. The pages off screen are
 * inert, so Tab never jumps the strip sideways.
 */
export function PageStrip({ pages, children }: { pages: readonly StripPage[]; children: React.ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string | null>(pages[0]?.anchor ?? null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  /** Anchors of the pages in the strip now: a page loaded later may leave it (nothing under the filters). */
  const [present, setPresent] = useState<ReadonlySet<string> | null>(null);
  /** Bumped whenever the strip's pages are added, removed or replaced (a new filter remounts them). */
  const [layout, setLayout] = useState(0);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(nearest(el)?.id ?? null));
    };
    const changed = (): void => {
      setPresent(new Set(pagesOf(el).map((p) => p.id)));
      setLayout((n) => n + 1);
      update();
    };
    changed();
    const mutations = new MutationObserver(changed);
    mutations.observe(el, { childList: true });
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Follows the height of the page on screen, also while its visuals arrive; the others are inert.
  useEffect(() => {
    const el = strip.current;
    const page = active ? document.getElementById(active) : null;
    if (!el || !page || page.parentElement !== el) return;
    for (const p of pagesOf(el)) p.inert = p !== page;
    const measure = (): void => setHeight(Math.ceil(page.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [active, layout]);

  // The tab of the page on screen stays in sight in its row (sideways only: the page never moves).
  useEffect(() => {
    const row = tabs.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const left = tab.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - 8, behavior: reducedMotion() ? "instant" : "smooth" });
    }
  }, [active]);

  const go = (anchor: string): void => {
    const el = strip.current;
    const page = document.getElementById(anchor);
    if (el && page) el.scrollTo({ left: page.offsetLeft, behavior: reducedMotion() ? "instant" : "smooth" });
  };

  const listed = present === null ? pages : pages.filter((p) => present.has(p.anchor));

  return (
    <div>
      {listed.length > 1 && (
        <nav ref={tabs} aria-label="Páginas do dashboard" className="scroll-quiet relative -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
          {listed.map((p) => (
            <button
              key={p.anchor}
              type="button"
              onClick={() => go(p.anchor)}
              aria-current={p.anchor === active ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                p.anchor === active ? "bg-brand font-medium text-white" : "text-text/70 hover:bg-text/5 hover:text-text"
              }`}
            >
              {p.title}
            </button>
          ))}
        </nav>
      )}
      <div
        ref={strip}
        {...{ [STRIP_ATTR]: "" }}
        role="region"
        aria-label="Páginas lado a lado: role para o lado ou use as abas"
        tabIndex={0}
        style={height ? { height } : undefined}
        className="relative flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-safe:scroll-smooth motion-safe:transition-[height] motion-safe:duration-200"
      >
        {children}
      </div>
    </div>
  );
}
