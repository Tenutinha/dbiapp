"use client";

import { useBusy } from "./busy";
import { CardProgress } from "./CardProgress";

interface VisualCardProps {
  title: string;
  className: string;
  children: React.ReactNode;
}

/**
 * Card of one visual. While the dashboard recalculates (a filter changed, an item was picked) the body
 * gives way to a skeleton of the same size, so the page keeps its shape and the reader sees that the
 * numbers on screen are about to be replaced; a thin bar runs along the top edge meanwhile.
 */
export function VisualCard({ title, className, children }: VisualCardProps) {
  const busy = useBusy();
  return (
    <section className={`card relative p-5 ${className}`} aria-busy={busy || undefined}>
      <h2 className="text-xs font-medium text-muted">{title}</h2>
      <div className={busy ? "invisible" : undefined}>{children}</div>
      {busy && <CardProgress />}
      {busy && <div aria-hidden className="absolute inset-x-5 bottom-5 top-11 animate-pulse rounded-lg bg-text/10" />}
    </section>
  );
}
