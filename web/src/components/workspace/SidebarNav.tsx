import type { TocGroup } from "@/lib/layout/toc";
import { DashboardNavItem } from "./DashboardNavItem";

interface SidebarNavProps {
  toc: TocGroup[];
  currentId: string | null;
}

/**
 * Reading mode: grouped, numbered list of the space's published dashboards. Choosing one opens
 * it on the space's own address (the URL does not change).
 */
export function SidebarNav({ toc, currentId }: SidebarNavProps) {
  // Viewing screen: nothing linked, nothing shown.
  if (toc.length === 0) return null;

  return (
    <nav aria-label="Dashboards" className="flex flex-col gap-6">
      {toc.map((group) => (
        <div key={group.section?.id ?? "none"}>
          {group.section && <p className="mb-2 text-[13px] text-ink-muted">{group.section.title}</p>}
          <ul className="border-l border-paper-line">
            {group.items.map((item) => (
              <li key={item.id}>
                <DashboardNavItem id={item.id} name={item.name} number={item.number} active={item.id === currentId} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
