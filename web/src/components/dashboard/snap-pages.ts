/**
 * The page-by-page scroll of a dashboard of pages (template paging "pages"): what one turn of the mouse wheel
 * does, given where the pages are on screen. Pure — SnapPages.tsx applies it.
 *
 * A page that fits the screen is never scrolled through: a firm turn of the wheel (two notches) takes the next
 * one whole, at once. A page taller than the screen scrolls inside itself, exactly to its end, and then the
 * same firm turn takes the next. Before the first page and after the last, the page scrolls as any other.
 */

/** A page's edges, in px from the top of the screen. */
export interface PageBox {
  top: number;
  bottom: number;
}

export interface Screen {
  /** Where a page starts on screen: under the fixed header. */
  top: number;
  bottom: number;
}

export type WheelMove =
  /** Leave the wheel to the browser. */
  | { kind: "native" }
  /** Scroll by this much, at once (inside a tall page, never past its edge). */
  | { kind: "scroll"; by: number }
  /** At the edge of the page: the turn counts towards taking the next one. `by` is the scroll that shows it. */
  | { kind: "turn"; by: number };

/** Turn of the wheel that takes the next page: two notches of a common mouse (100 px each). */
export const TURN_PX = 150;
/** Slack for rounding: this close to an edge counts as on it. */
const EDGE = 2;

/** The page on screen: the last one that starts at (or above) where pages start. */
export function currentPage(pages: readonly PageBox[], screen: Screen): number {
  let current = -1;
  pages.forEach((p, i) => {
    if (p.top <= screen.top + EDGE) current = i;
  });
  return current;
}

export function wheelMove(pages: readonly PageBox[], screen: Screen, deltaY: number): WheelMove {
  if (deltaY === 0 || pages.length === 0) return { kind: "native" };
  const i = currentPage(pages, screen);
  const down = deltaY > 0;
  // Above the first page (the filters, the cards before it): the wheel is the browser's until a page starts.
  if (i < 0) return { kind: "native" };
  const page = pages[i];
  // Scrolled past the end of the last page (the footer, the next dashboard): the browser's too.
  if (page.bottom < screen.top) return { kind: "native" };
  if (down) {
    const left = page.bottom - screen.bottom;
    if (left > EDGE) return { kind: "scroll", by: Math.min(deltaY, left) };
    const next = pages[i + 1];
    return next ? { kind: "turn", by: next.top - screen.top } : { kind: "native" };
  }
  const above = screen.top - page.top;
  if (above > EDGE) return { kind: "scroll", by: -Math.min(-deltaY, above) };
  const previous = pages[i - 1];
  if (!previous) return { kind: "native" };
  // Going up lands on the end of the page above (its start, when it fits the screen).
  const fits = previous.bottom - previous.top <= screen.bottom - screen.top + EDGE;
  return { kind: "turn", by: fits ? previous.top - screen.top : previous.bottom - screen.bottom };
}
