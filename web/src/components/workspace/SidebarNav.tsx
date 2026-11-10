import Link from "next/link";
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
  /**
   * Public link (no account): each dashboard is a plain link to this address instead of the signed-in
   * "open" action, which remembers the choice per user.
   */
  hrefFor?: (id: string) => string;
}

function PublicNavItem({ href, name, number, active }: { href: string; name: string; number: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-ml-px flex w-full items-baseline justify-between gap-3 border-l py-1 pl-3 pr-1 text-left text-[15px] leading-snug transition-colors ${
        active ? "border-ink font-medium text-ink" : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
      }`}
    >
      <span>{name}</span>
      <span className="shrink-0 tabular-nums text-ink-muted">{number}</span>
    </Link>
  );
}

/**
 * Reading mode: the published dashboards of the space, grouped and numbered, each with its analyses
 * nested under it. Choosing a dashboard or an analysis opens it on the address of the space (the URL
 * does not change), or on the public link's address when `hrefFor` is given.
 */
export function SidebarNav({ toc, currentId, outlines, hrefFor }: SidebarNavProps) {
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
                {hrefFor ? (
                  <PublicNavItem href={hrefFor(item.id)} name={item.name} number={item.number} active={item.id === currentId} />
                ) : (
                  <DashboardNavItem id={item.id} name={item.name} number={item.number} active={item.id === currentId} />
                )}
                <DashboardOutline
                  dashboardId={item.id}
                  dashboardName={item.name}
                  current={item.id === currentId}
                  items={outlines[item.id] ?? []}
                  href={hrefFor?.(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
