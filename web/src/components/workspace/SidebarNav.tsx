import type { TocGroup } from "@/lib/layout/toc";
import type { SummaryItem } from "@/lib/templates/sections";
import { DashboardNavItem } from "./DashboardNavItem";
import { DashboardOutline } from "./DashboardOutline";

interface SidebarNavProps {
  toc: TocGroup[];
  currentId: string | null;
  /** Analyses of the open dashboard, nested under its name; the other dashboards show only their name. */
  outline: SummaryItem[];
}

/**
 * Reading mode: the space's published dashboards, grouped and numbered, with the analyses of the open
 * one nested under it. Choosing a dashboard opens it on the space's own address (the URL does not change).
 */
export function SidebarNav({ toc, currentId, outline }: SidebarNavProps) {
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
                {item.id === currentId && <DashboardOutline dashboardName={item.name} items={outline} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
