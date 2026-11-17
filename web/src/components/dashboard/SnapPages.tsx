"use client";

import { useEffect } from "react";
import { TURN_PX, wheelMove, type PageBox } from "./snap-pages";

/** The pages (the analyses) and the area of the dashboard whose wheel is taken (see DashboardView). */
const PAGE = ".snap-page";
const AREA = ".dash-pages";
/** A turn of the wheel is one gesture while its notches come this close together. */
const GESTURE_MS = 300;
/** After a page is taken, the rest of the same gesture (a trackpad keeps sending) does not take another. */
const REST_MS = 450;

/** Whether something between the wheel's target and the page can still scroll that way (a table, a list). */
function scrollsInside(target: Element, deltaY: number): boolean {
  for (let el: Element | null = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (deltaY > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * The page-by-page scroll of a dashboard whose template asks for it (paging "pages"): the mouse wheel over
 * the dashboard takes whole pages at once instead of creeping (see snap-pages.ts). A table that still has
 * rows to scroll keeps its wheel; the keyboard, touch and the scrollbar scroll as in any page.
 */
export function SnapPages() {
  useEffect(() => {
    let turned = 0;
    let lastNotch = 0;
    let restUntil = 0;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(AREA) || scrollsInside(target, e.deltaY)) return;
      const sections = Array.from(document.querySelectorAll<HTMLElement>(PAGE));
      if (sections.length === 0) return;
      // Lines (Firefox) and pages count as pixels of a common notch.
      const deltaY = e.deltaMode === 0 ? e.deltaY : Math.sign(e.deltaY) * 100;
      const top = parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0;
      const boxes: PageBox[] = sections.map((s) => {
        const box = s.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      });
      const move = wheelMove(boxes, { top, bottom: window.innerHeight }, deltaY);
      if (move.kind === "native") return;
      e.preventDefault();
      const now = performance.now();
      if (move.kind === "scroll") {
        turned = 0;
        window.scrollBy({ top: move.by, behavior: "instant" });
        return;
      }
      if (now < restUntil) return;
      // A new gesture, or one that changed direction, starts counting again.
      if (now - lastNotch > GESTURE_MS || Math.sign(turned) !== Math.sign(deltaY)) turned = 0;
      lastNotch = now;
      turned += deltaY;
      if (Math.abs(turned) < TURN_PX) return;
      turned = 0;
      restUntil = now + REST_MS;
      window.scrollBy({ top: move.by, behavior: "instant" });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
