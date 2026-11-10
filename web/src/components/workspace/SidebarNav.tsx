import type { TocGroup } from "@/lib/layout/toc";
import type { SummaryItem } from "@/lib/templates/sections";
import { DashboardNavItem } from "./DashboardNavItem";
import { DashboardOutline } from "./DashboardOutline";

/** Analyses of each dashboard of the space, by dashboard id (absent = nothing to nest). */
export type Outlines = Readonly<Record<string, SummaryItem[]>>;

interface SidebarNavProps {
  toc: TocGroup[];
  currentId: string | null;
  outlines: Outlines;
}

/**
 * Reading mode: the published dashboards of the space, grouped and numbered, each with its analyses
 * nested under it. Choosing a dashboard or an analysis opens it on the address of the space (the URL
 * does not change).
 */
export function SidebarNav({ toc, currentId, outlines }: SidebarNavProps) {
  // Viewing screen: nothing linked, nothing shown.
  if (toc.length === 0) return null;

  return (
    <nav aria-label="Sumário" className="flex flex-col gap-6">
      {toc.map((group) => (
        <div key={group.section?.id ?? "none"}>
          {group.section && <p className="mb-2 text-[13px] text-ink-muted">{group.section.title}</p>}
          <ul className="border-l border-paper-line">
            {group.items.map((item) => (
              <li key={item.id}>
                <DashboardNavItem id={item.id} name={item.name} number={item.number} active={item.id === currentId} />
                <DashboardOutline
                  dashboardId={item.id}
                  dashboardName={item.name}
                  current={item.id === currentId}
                  items={outlines[item.id] ?? []}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
