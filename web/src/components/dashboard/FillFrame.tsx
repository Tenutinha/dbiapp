"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Marks the dashboard header, the top edge of what a filling visual covers. */
export const DASH_HEADER_ATTR = "data-dash-header";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Stretches its content over the whole content area: from the header down to the bottom of the screen and
 * from the sidebar to the right edge, past the page's padding and its reading width. It stays in the flow
 * of the page (nothing under it is hidden), only its margins pull it out to the edges.
 */
export function FillFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Offsets applied so far: the element's natural place is its rect minus them.
  const [box, setBox] = useState<Box | null>(null);
  const applied = useRef<Box>({ left: 0, top: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    const main = el?.closest("main");
    if (!el || !main) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const area = main.getBoundingClientRect();
      const header = document.querySelector(`[${DASH_HEADER_ATTR}]`)?.getBoundingClientRect();
      const naturalLeft = rect.left - applied.current.left;
      const naturalTop = rect.top + window.scrollY - applied.current.top;
      // The header's bottom on the page (it is sticky: its place while the page is at the top).
      const headerBottom = header ? header.bottom + window.scrollY : naturalTop;
      const next: Box = {
        left: area.left - naturalLeft,
        top: Math.min(0, headerBottom - naturalTop),
        width: area.width,
        height: Math.max(360, window.innerHeight - (header ? header.height + Math.max(0, header.top) : 0)),
      };
      const same = Object.keys(next).every((k) => Math.abs(next[k as keyof Box] - applied.current[k as keyof Box]) < 0.5);
      if (same) return;
      applied.current = next;
      setBox(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // While the frame is on screen the page does not scroll: the wheel and the fingers are the visual's alone
  // (zooming a map), and the page stays with the frame filling the window.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = { overflow: root.style.overflow, overscroll: root.style.overscrollBehavior };
    window.scrollTo(0, 0);
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overflow = before.overflow;
      root.style.overscrollBehavior = before.overscroll;
    };
  }, []);

  return (
    <div
      ref={ref}
      className="relative"
      style={box
        ? { marginLeft: box.left, marginTop: box.top, width: box.width, height: box.height }
        : { height: "calc(100dvh - 3.5rem)" }}
    >
      {children}
    </div>
  );
}
