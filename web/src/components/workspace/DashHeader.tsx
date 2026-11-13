"use client";

import { useActiveAnchor } from "./active-anchor";
import { PageScrollbar } from "./PageScrollbar";
import { useComing } from "./switching";

export interface HeaderTopic {
  anchor: string;
  title: string;
}

interface DashHeaderProps {
  /** Name of the open dashboard. */
  title: string;
  /** Its analyses in reading order: the one on screen is named after the dashboard. */
  topics: readonly HeaderTopic[];
  /** "Atualizado em …" of the open dashboard, on the right of the bar (none: nothing shown). */
  updated?: string | null;
}

/**
 * Fixed bar on top of the dashboard area, from the sidebar to the right edge of the window: "Dashboard ·
 * Tópico", the topic following the page or section on screen; the visuals scroll under it. While another
 * dashboard is on its way it already names that one. Its colour is the space's "Cabeçalho do dashboard".
 * The negative margins cancel the content area's padding (SidebarShell's <main>).
 */
export function DashHeader({ title, topics, updated }: DashHeaderProps) {
  const active = useActiveAnchor(topics.map((t) => t.anchor).join("|"));
  const coming = useComing();
  const topic = coming === null ? (topics.find((t) => t.anchor === active) ?? topics[0]) : undefined;
  return (
    <header className="sticky top-14 z-20 -mx-4 mb-5 bg-header text-on-header shadow-sm sm:-mx-8 lg:top-0 lg:-mx-14">
      <div className="mx-auto max-w-[1180px] box-content px-4 sm:px-8 lg:px-14">
      <div className="flex min-h-12 items-center justify-between gap-4 py-2.5">
        <h1 className="min-w-0 truncate text-[15px] font-semibold leading-snug" aria-busy={coming !== null || undefined}>
          {coming ?? title}
          {topic && (
            <span className="font-normal opacity-80" aria-live="polite">
              {" "}· {topic.title}
            </span>
          )}
        </h1>
        {/* The date belongs to the open dashboard: left out while another one is on its way. */}
        {updated && coming === null && <p className="shrink-0 text-[12px] opacity-80">{updated}</p>}
      </div>
      {/* Pages side by side: their scrollbar lives here, always in sight. */}
      {coming === null && <PageScrollbar />}
      </div>
    </header>
  );
}
