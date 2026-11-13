"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Where the strip of pages is scrolled: its pages, the share on screen and how far along it is (0 to 1). */
interface StripView {
  pages: number;
  /** Share of the strip on screen (one page out of `pages`). */
  ratio: number;
  /** 0 at the first page, 1 at the last. */
  position: number;
}

const STRIP = "[data-page-strip]";

function pagesOf(strip: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>(":scope > section"));
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
    if (Math.abs(p.offsetLeft - strip.scrollLeft) < Math.abs(pages[best].offsetLeft - strip.scrollLeft)) best = i;
  });
  return best;
}

function goTo(strip: HTMLElement, index: number): void {
  const pages = pagesOf(strip);
  const page = pages[Math.max(0, Math.min(index, pages.length - 1))];
  if (page) strip.scrollTo({ left: page.offsetLeft, behavior: reducedMotion() ? "instant" : "smooth" });
}

/** The strip of pages on screen, found again whenever the page content changes (a new dashboard, Suspense). */
function useStrip(): HTMLElement | null {
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const find = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStrip(document.querySelector<HTMLElement>(STRIP)));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return strip;
}

const ARROW = "grid size-6 shrink-0 place-items-center rounded-md text-sm leading-none transition hover:bg-on-header/15 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * The sideways scrollbar of a dashboard whose analyses are pages side by side, shown in the fixed header
 * (always in sight) instead of under the strip, which may be a whole screen below: arrows to the previous
 * and next page, and a track whose thumb follows the strip — click a spot to go to that page, or drag it.
 * Nothing for dashboards read top to bottom.
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

  // Dragging the thumb scrolls the strip freely; the snap comes back (to the nearest page) on release.
  const onThumbDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!strip) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
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
