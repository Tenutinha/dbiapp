"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The page's scroll, as the rail draws it: where the rail starts and the thumb's size and place (px). */
interface RailView {
  top: number;
  thumb: number;
  offset: number;
}

const MIN_THUMB = 32;
/** Class on <html> that hides the browser's own scrollbar while this one is on screen (globals.css). */
const HIDE_NATIVE = "main-scrollbar";

function railView(header: HTMLElement): RailView | null {
  const doc = document.documentElement;
  const room = doc.scrollHeight - window.innerHeight;
  if (room <= 1) return null;
  const top = Math.max(0, Math.round(header.getBoundingClientRect().bottom));
  const rail = window.innerHeight - top;
  const thumb = Math.max(MIN_THUMB, (rail * window.innerHeight) / doc.scrollHeight);
  return { top, thumb, offset: (Math.min(window.scrollY, room) / room) * (rail - thumb) };
}

/**
 * The page's vertical scrollbar on a dashboard, drawn by us instead of the browser's (which in Windows has
 * arrows and a grey gutter) and starting under the fixed header, so it only spans the area that scrolls:
 * a thin rounded thumb that widens under the pointer, can be dragged, and pages up or down when the rail
 * is clicked. Only with a mouse — on touch screens the system's own overlay bar stays.
 */
export function MainScrollbar({ header }: { header: RefObject<HTMLElement | null> }) {
  const [view, setView] = useState<RailView | null>(null);
  const [fine, setFine] = useState(false);
  const [active, setActive] = useState(false);
  const drag = useRef<{ y: number; scroll: number; perPx: number } | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const sync = (): void => setFine(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = header.current;
    if (!fine || !el) return;
    const html = document.documentElement;
    html.classList.add(HIDE_NATIVE);
    let frame = 0;
    let idle = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView(railView(el)));
    };
    const onScroll = (): void => {
      update();
      setActive(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setActive(false), 900);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const sizes = new ResizeObserver(update);
    sizes.observe(document.body);
    sizes.observe(el);
    return () => {
      html.classList.remove(HIDE_NATIVE);
      cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      sizes.disconnect();
    };
  }, [fine, header]);

  const onThumbDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!view) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const travel = window.innerHeight - view.top - view.thumb;
      drag.current = { y: e.clientY, scroll: window.scrollY, perPx: travel > 0 ? room / travel : 0 };
    },
    [view],
  );
  const onThumbMove = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    window.scrollTo({ top: drag.current.scroll + (e.clientY - drag.current.y) * drag.current.perPx, behavior: "instant" });
  }, []);
  const onThumbUp = useCallback(() => {
    drag.current = null;
  }, []);

  if (!fine || !view) return null;

  // A click on the rail pages towards it, as the browser's own bar does.
  const onRail = (e: React.PointerEvent<HTMLDivElement>): void => {
    const thumbTop = view.top + view.offset;
    const page = (window.innerHeight - view.top) * 0.9;
    window.scrollBy({ top: e.clientY < thumbTop ? -page : page, behavior: "smooth" });
  };

  const dragging = drag.current !== null;
  return (
    <div
      aria-hidden
      onPointerDown={onRail}
      className="group fixed bottom-0 right-0 z-30 w-3 cursor-default"
      style={{ top: view.top }}
    >
      <span
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
        className={`absolute right-0.5 w-1.5 touch-none rounded-full bg-text transition-[width,opacity] duration-200 group-hover:w-2 group-hover:opacity-45 ${
          active || dragging ? "opacity-40" : "opacity-20"
        }`}
        style={{ top: view.offset + 2, height: view.thumb - 4 }}
      />
    </div>
  );
}
