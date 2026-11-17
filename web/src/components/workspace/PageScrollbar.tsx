"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STRIP_ATTR } from "@/components/dashboard/PageStrip";
import { CARD_STRIP_ATTR, HEADER_DRIVEN_ATTR, STRIP_CARD_ATTR } from "@/components/dashboard/strip-attrs";

/** Where the strip of pages is scrolled: its pages, the share on screen and how far along it is (0 to 1). */
interface StripView {
  pages: number;
  /** Share of the strip on screen (one page out of `pages`). */
  ratio: number;
  /** 0 at the first page, 1 at the last. */
  position: number;
}

const STRIP = `[${STRIP_ATTR}]`;
const CARDS = `[${CARD_STRIP_ATTR}]`;
/** An analysis counts as on screen with at least this much of it in view. */
const MIN_IN_VIEW = 48;

/** The pages of a strip: the analyses of a dashboard turned sideways, or the visuals of one analysis side by side. */
function pagesOf(strip: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>(strip.hasAttribute(CARD_STRIP_ATTR) ? `[${STRIP_CARD_ATTR}]` : ":scope > section"));
}

/** Where a page starts in its strip (the first one at 0, whatever padding the strip has). */
function startOf(pages: readonly HTMLElement[], page: HTMLElement): number {
  return page.offsetLeft - (pages[0]?.offsetLeft ?? 0);
}

/** How much of an element is on screen, in px of height. */
function inView(el: Element): number {
  const box = el.getBoundingClientRect();
  return Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
}

/**
 * The strip the header scrolls: the dashboard's pages when it has them; else the strip of visuals of the
 * analysis being read — the one with most of itself on screen — even while the strip itself is still below
 * the fold (under the filters, the cards and a chart): the reader learns from the header that the analysis
 * has more to the side. None while no analysis with a strip is on screen.
 */
function findStrip(): HTMLElement | null {
  const pages = document.querySelector<HTMLElement>(STRIP);
  if (pages) return pages;
  let best: HTMLElement | null = null;
  let most = MIN_IN_VIEW;
  // What is on screen besides strips: an analysis without one that takes more of the screen wins, and shows no bar.
  const strips = new Map<Element, HTMLElement>();
  for (const strip of document.querySelectorAll<HTMLElement>(CARDS)) strips.set(strip.closest("section[id]") ?? strip, strip);
  const analyses = new Set<Element>([...strips.keys(), ...document.querySelectorAll("section[id][aria-labelledby]")]);
  for (const analysis of analyses) {
    const seen = inView(analysis);
    if (seen >= most) [best, most] = [strips.get(analysis) ?? null, seen];
  }
  return best;
}

/** Brings a strip of visuals into sight when the header turns it while it is off screen. */
function reveal(strip: HTMLElement): void {
  if (!strip.hasAttribute(CARD_STRIP_ATTR)) return;
  const box = strip.getBoundingClientRect();
  if (box.top >= 0 && box.bottom <= window.innerHeight) return;
  strip.scrollIntoView({ block: box.height > window.innerHeight ? "start" : "nearest", behavior: "instant" });
}

function viewOf(strip: HTMLElement): StripView | null {
  const pages = pagesOf(strip).length;
  const room = strip.scrollWidth - strip.clientWidth;
  if (pages < 2 || room <= 1) return null;
  return { pages, ratio: strip.clientWidth / strip.scrollWidth, position: Math.min(1, Math.max(0, strip.scrollLeft / room)) };
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The page nearest to where the strip is scrolled. */
function currentPage(strip: HTMLElement): number {
  const pages = pagesOf(strip);
  let best = 0;
  pages.forEach((p, i) => {
    if (Math.abs(startOf(pages, p) - strip.scrollLeft) < Math.abs(startOf(pages, pages[best]) - strip.scrollLeft)) best = i;
  });
  return best;
}

function goTo(strip: HTMLElement, index: number): void {
  const pages = pagesOf(strip);
  const page = pages[Math.max(0, Math.min(index, pages.length - 1))];
  reveal(strip);
  if (page) strip.scrollTo({ left: startOf(pages, page), behavior: reducedMotion() ? "instant" : "smooth" });
}

/**
 * The strip on screen, found again whenever the page content changes (a new dashboard, Suspense) and, for the
 * strips of visuals, as the reader scrolls from one analysis to another.
 */
function useStrip(): HTMLElement | null {
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const find = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStrip(findStrip()));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    // Captured: the page scrolls inside the workspace, not the window.
    document.addEventListener("scroll", find, { capture: true, passive: true });
    window.addEventListener("resize", find);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("scroll", find, { capture: true });
      window.removeEventListener("resize", find);
    };
  }, []);
  return strip;
}

const ARROW = "grid size-6 shrink-0 place-items-center rounded-md text-sm leading-none transition hover:bg-on-header/15 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * The sideways scrollbar of a dashboard whose analyses are pages side by side, shown in the fixed header
 * (always in sight) instead of under the strip, which may be a whole screen below: arrows to the previous
 * and next page, and a track whose thumb follows the strip — click a spot to go to that page, or drag it.
 * In a dashboard read top to bottom, it shows only while an analysis whose visuals sit side by side is on screen,
 * and scrolls those.
 */
export function PageScrollbar() {
  const strip = useStrip();
  const [view, setView] = useState<StripView | null>(null);
  const [page, setPage] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);

  useEffect(() => {
    if (!strip) {
      setView(null);
      return;
    }
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setView(viewOf(strip));
        setPage(currentPage(strip));
      });
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const sizes = new ResizeObserver(update);
    sizes.observe(strip);
    const children = new MutationObserver(update);
    children.observe(strip, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      strip.removeEventListener("scroll", update);
      sizes.disconnect();
      children.disconnect();
    };
  }, [strip]);

  // While this bar stands for the strip's own, the strip hides its native one.
  const driving = strip !== null && view !== null;
  useEffect(() => {
    if (!strip || !driving) return undefined;
    strip.setAttribute(HEADER_DRIVEN_ATTR, "");
    return () => strip.removeAttribute(HEADER_DRIVEN_ATTR);
  }, [strip, driving]);

  // Dragging the thumb scrolls the strip freely; the snap comes back (to the nearest page) on release.
  const onThumbDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!strip) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    reveal(strip);
    strip.style.scrollSnapType = "none";
    strip.style.scrollBehavior = "auto";
    drag.current = { x: e.clientX, left: strip.scrollLeft };
  }, [strip]);
  const onThumbMove = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    const width = track.current?.clientWidth;
    if (!strip || !drag.current || !width) return;
    strip.scrollLeft = drag.current.left + ((e.clientX - drag.current.x) * strip.scrollWidth) / width;
  }, [strip]);
  const onThumbUp = useCallback(() => {
    if (!strip || !drag.current) return;
    drag.current = null;
    strip.style.scrollSnapType = "";
    strip.style.scrollBehavior = "";
    goTo(strip, currentPage(strip));
  }, [strip]);

  if (!strip || !view) return null;

  const onTrack = (e: React.MouseEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    goTo(strip, Math.floor(((e.clientX - box.left) / box.width) * view.pages));
  };

  return (
    <div className="flex items-center gap-2 pb-2">
      <button type="button" className={ARROW} onClick={() => goTo(strip, page - 1)} disabled={page === 0} aria-label="Página anterior">
        ‹
      </button>
      <div
        ref={track}
        onClick={onTrack}
        role="scrollbar"
        aria-controls={strip.id || undefined}
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={view.pages}
        aria-valuenow={page + 1}
        aria-valuetext={`Página ${page + 1} de ${view.pages}`}
        className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-on-header/20"
      >
        <span
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-on-header/80 active:cursor-grabbing"
          style={{ left: `${view.position * (1 - view.ratio) * 100}%`, width: `${view.ratio * 100}%` }}
        />
      </div>
      <button type="button" className={ARROW} onClick={() => goTo(strip, page + 1)} disabled={page >= view.pages - 1} aria-label="Próxima página">
        ›
      </button>
      <span className="shrink-0 text-[11px] tabular-nums opacity-80">
        {page + 1}/{view.pages}
      </span>
    </div>
  );
}
