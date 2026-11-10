"use client";

import { useEffect, useState } from "react";
import type { SummaryGroupView } from "@/lib/templates/sections";

interface DashboardSummaryProps {
  title: string;
  groups: SummaryGroupView[];
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

/** Sidebar summary of the open dashboard: its groups of analyses, linking to each page section. */
export function DashboardSummary({ title, groups }: DashboardSummaryProps) {
  const anchors = groups.flatMap((g) => g.items.map((i) => i.anchor));
  const key = anchors.join("|");
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

  return (
    <nav aria-label={`Sumário de ${title}`} className="mb-8 flex flex-col gap-5 border-b border-paper-line pb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Neste dashboard</p>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-2 text-[13px] text-ink-muted">{g.title}</p>
          <ul className="border-l border-paper-line">
            {g.items.map((item) => {
              const on = item.anchor === active;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.anchor}`}
                    aria-current={on ? "location" : undefined}
                    className={`-ml-px flex items-baseline justify-between gap-3 border-l py-1 pl-3 pr-1 text-[15px] leading-snug transition-colors ${
                      on ? "border-ink font-medium text-ink" : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
                    }`}
                  >
                    <span>{item.title}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">{item.number}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
