"use client";

import { useEffect, useRef } from "react";
import { FunnelIcon } from "@/components/dashboard/FilterBar";
import { filterDock, useFilterDock } from "@/components/dashboard/filter-dock";
import { useActiveAnchor } from "./active-anchor";
import { MainScrollbar } from "./MainScrollbar";
import { PageScrollbar } from "./PageScrollbar";
import { useHostSidebarToggle, useSidebar } from "./sidebar-context";
import { HamburgerIcon } from "./SidebarShell";
import { SpaceLogo } from "./ThemeScope";
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
/**
 * The dashboard's filters, as an icon in the header (the FilterBar then drops its floating button and opens
 * its panel under the icon). The badge counts the filters in use and the items picked in the visuals.
 */
function FiltersButton() {
  const dock = useFilterDock();
  useEffect(() => filterDock.dock(), []);
  if (!dock.available) return null;
  return (
    <button
      type="button"
      onClick={(e) => filterDock.toggle(e.currentTarget.getBoundingClientRect())}
      aria-expanded={dock.open}
      aria-controls="painel-filtros"
      aria-label={dock.count > 0 ? `Filtros (${dock.count} em uso)` : "Filtros"}
      title="Filtros"
      className={`relative grid size-8 shrink-0 place-items-center rounded-lg transition [&_svg]:size-4 ${
        dock.open ? "bg-on-header/20" : "hover:bg-on-header/15"
      } ${dock.pending ? "animate-pulse" : ""}`}
    >
      <FunnelIcon />
      {dock.count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-on-header px-1 text-center text-[10px] font-semibold leading-4 text-header">
          {dock.count}
        </span>
      )}
    </button>
  );
}

export function DashHeader({ title, topics, updated }: DashHeaderProps) {
  const active = useActiveAnchor(topics.map((t) => t.anchor).join("|"));
  const coming = useComing();
  const topic = coming === null ? (topics.find((t) => t.anchor === active) ?? topics[0]) : undefined;
  const sidebar = useSidebar();
  useHostSidebarToggle(sidebar);
  const collapsed = sidebar?.collapsed === true;
  const ref = useRef<HTMLElement>(null);
  return (
    <header ref={ref} className="sticky top-14 z-20 -mx-4 mb-5 bg-header text-on-header shadow-sm sm:-mx-8 lg:top-0 lg:-mx-14">
      {/* Panel collapsed (wide screens): the button that opens it and the space's logo, where the panel had them,
          out of the flow so the title stays in line with the visuals below. */}
      {collapsed && (
        <div className="absolute left-0 top-0 hidden items-center gap-3 py-2.5 pl-4 lg:flex">
          <button
            type="button"
            onClick={sidebar?.expand}
            aria-expanded={false}
            aria-controls="space-sidebar"
            aria-label="Abrir sumário"
            title="Abrir sumário"
            className="grid size-8 place-items-center rounded-lg transition hover:bg-on-header/15"
          >
            <HamburgerIcon />
          </button>
          {sidebar?.logoUrl && <SpaceLogo url={sidebar.logoUrl} className="block max-h-8 max-w-[160px]" />}
        </div>
      )}
      {/* In line with the dashboard's centred column; with the panel collapsed, never under the logo (15rem). */}
      <div
        className={`mx-auto min-w-0 max-w-[1180px] box-content px-4 sm:px-8 lg:px-14 ${
          collapsed ? "lg:mx-0 lg:max-w-none lg:pl-[max(15rem,calc((100%-1180px)/2))] lg:pr-[max(3.5rem,calc((100%-1180px)/2))]" : ""
        }`}
      >
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
        <div className="flex shrink-0 items-center gap-3">
          {updated && coming === null && <p className="text-[12px] opacity-80">{updated}</p>}
          <FiltersButton />
        </div>
      </div>
      {/* Pages side by side: their scrollbar lives here, always in sight. */}
      {coming === null && <PageScrollbar />}
      <MainScrollbar header={ref} />
      </div>
    </header>
  );
}
