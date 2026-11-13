"use client";

import { useEffect, useState } from "react";

/** Section whose top already passed this line (px from the viewport top) counts as the current one. */
const CURRENT_LINE = 140;

/**
 * The analysis on screen. Sections one below the other: the last one whose top has scrolled above the
 * current line. Sections turned sideways (pages of a strip, see PageStrip): the page whose middle is inside
 * the strip, wherever the strip is on the screen (it starts below the line when the page is at its top).
 */
function currentAnchor(anchors: readonly string[]): string | null {
  let current: string | null = null;
  for (const anchor of anchors) {
    const el = document.getElementById(anchor);
    if (!el) continue;
    const box = el.getBoundingClientRect();
    if (el.parentElement?.hasAttribute("data-page-strip")) {
      const strip = el.parentElement.getBoundingClientRect();
      const middle = (box.left + box.right) / 2;
      if (middle >= strip.left && middle <= strip.right) return anchor;
      continue;
    }
    if (box.top <= CURRENT_LINE) current = anchor;
  }
  return current;
}

/**
 * Anchor of the analysis being read, following the page scroll (and a strip's sideways scroll) while
 * `enabled`; null otherwise or before the first section reaches the top. `key` is the anchors joined by "|".
 */
export function useActiveAnchor(key: string, enabled = true): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || key === "") return;
    const list = key.split("|");
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentAnchor(list)));
    };
    update();
    // Captured: a strip of pages scrolls by itself, sideways, and its scroll does not bubble.
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [key, enabled]);
  return enabled ? active : null;
}
