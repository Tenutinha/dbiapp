"use client";

import { useActiveAnchor } from "./active-anchor";

export interface HeaderTopic {
  anchor: string;
  title: string;
}

interface DashHeaderProps {
  /** Name of the open dashboard. */
  title: string;
  /** Its analyses in reading order: the one on screen is named after the dashboard. */
  topics: readonly HeaderTopic[];
}

/** Classes of the bar, shared with the skeleton shown while another dashboard is on its way. */
export const DASH_HEADER_CLASS =
  "sticky top-14 z-20 -mx-4 mb-5 flex min-h-12 items-center bg-header px-4 py-2.5 text-on-header shadow-sm lg:top-0";

/**
 * Fixed bar on top of the dashboard area: "Dashboard · Tópico", the topic following the page or section on
 * screen. The visuals scroll under it. Its colour is the space's "Cabeçalho do dashboard" (Aparência).
 */
export function DashHeader({ title, topics }: DashHeaderProps) {
  const active = useActiveAnchor(topics.map((t) => t.anchor).join("|"));
  const topic = topics.find((t) => t.anchor === active) ?? topics[0];
  return (
    <header className={DASH_HEADER_CLASS}>
      <h1 className="min-w-0 truncate text-[15px] font-semibold leading-snug">
        {title}
        {topic && (
          <span className="font-normal opacity-80" aria-live="polite">
            {" "}· {topic.title}
          </span>
        )}
      </h1>
    </header>
  );
}
