"use client";

import { useEffect, useState } from "react";
import type { SummaryItem } from "@/lib/templates/sections";

interface DashboardOutlineProps {
  dashboardName: string;
  items: SummaryItem[];
}

/** Section whose top already passed this line (px from the viewport top) counts as the current one. */
const CURRENT_LINE = 140;

/** The analysis on screen: the last section whose top has scrolled above the current line. */
function currentAnchor(anchors: readonly string[]): string | null {
  let current: string | null = null;
  for (const anchor of anchors) {
    const el = document.getElementById(anchor);
    if (el && el.getBoundingClientRect().top <= CURRENT_LINE) current = anchor;
  }
  return current;
}

/**
 * The analyses of the open dashboard, nested under its name in the sidebar: links to the page sections,
 * with the one on screen highlighted as the page scrolls.
 */
export function DashboardOutline({ dashboardName, items }: DashboardOutlineProps) {
  const key = items.map((i) => i.anchor).join("|");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const list = key.split("|");
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentAnchor(list)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [key]);

  if (items.length === 0) return null;

  return (
    <ul aria-label={`Análises de ${dashboardName}`} className="pb-2 pt-0.5">
      {items.map((item) => {
        const on = item.anchor === active;
        return (
          <li key={item.id}>
            <a
              href={`#${item.anchor}`}
              aria-current={on ? "location" : undefined}
              className={`flex items-baseline justify-between gap-3 py-[3px] pl-7 pr-1 text-[13px] leading-snug transition-colors ${
                on ? "font-medium text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              <span>{item.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-muted/70">{item.number}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
