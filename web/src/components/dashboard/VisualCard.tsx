"use client";

import { STRIP_CARD_ATTR } from "./strip-attrs";
import { useBusy } from "./busy";
import { CardProgress } from "./CardProgress";
import { useStale } from "./live";

interface VisualCardProps {
  title: string;
  className: string;
  children: React.ReactNode;
  /** Controls of the visual, at the right of its title (e.g. the field a table groups by). */
  tools?: React.ReactNode;
  /** A card of a strip of visuals side by side: one page of the strip's scrollbar. */
  strip?: boolean;
}

/**
 * Card of one visual. While its numbers are being recalculated (a filter changed, an item was picked) the
 * ones on screen stay where they are, dimmed, with a thin bar running along the top edge: the reader keeps
 * reading and sees that they are about to be replaced, instead of watching the page empty and fill again.
 */
export function VisualCard({ title, className, children, tools, strip }: VisualCardProps) {
  const recalculating = useBusy();
  const stale = useStale();
  const busy = recalculating || stale;
  return (
    <section className={`card relative p-5 ${className}`} aria-busy={busy || undefined} {...(strip ? { [STRIP_CARD_ATTR]: "" } : {})}>
      {tools ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-muted">{title}</h2>
          {tools}
        </div>
      ) : (
        <h2 className="text-xs font-medium text-muted">{title}</h2>
      )}
      <div className={`transition-opacity ${busy ? "opacity-50" : ""}`}>{children}</div>
      {busy && <CardProgress />}
    </section>
  );
}
