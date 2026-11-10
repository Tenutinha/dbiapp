import Link from "next/link";
import type { TocGroup } from "@/lib/layout/toc";
import { DashboardNavItem } from "./DashboardNavItem";

interface SidebarNavProps {
  toc: TocGroup[];
  currentId: string | null;
  /**
   * Public link (no account): each item is a plain link to this address instead of the signed-in
   * "open" action, which remembers the choice per user.
   */
  hrefFor?: (id: string) => string;
}

/**
 * Reading mode: grouped, numbered list of the space's published dashboards. Choosing one opens
 * it on the space's own address (the URL does not change).
 */
export function SidebarNav({ toc, currentId, hrefFor }: SidebarNavProps) {
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
                {hrefFor ? (
                  <Link
                    href={hrefFor(item.id)}
                    aria-current={item.id === currentId ? "page" : undefined}
                    className={`-ml-px flex w-full items-baseline justify-between gap-3 border-l py-1 pl-3 pr-1 text-left text-[15px] leading-snug transition-colors ${
                      item.id === currentId ? "border-ink font-medium text-ink" : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
                    }`}
                  >
                    <span>{item.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">{item.number}</span>
                  </Link>
                ) : (
                  <DashboardNavItem id={item.id} name={item.name} number={item.number} active={item.id === currentId} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
