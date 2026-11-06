import Link from "next/link";
import type { TocGroup } from "@/lib/layout/toc";

interface SidebarNavProps {
  orgSlug: string;
  toc: TocGroup[];
  currentId: string | null;
  canManage: boolean;
}

/** Reading mode: grouped, numbered list of the space's dashboards. */
export function SidebarNav({ orgSlug, toc, currentId, canManage }: SidebarNavProps) {
  if (toc.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-ink-muted">
        {canManage ? "Nenhum dashboard ainda. Use “Adicionar dashboard” abaixo." : "Nenhum dashboard publicado ainda."}
      </p>
    );
  }

  return (
    <nav aria-label="Dashboards" className="flex flex-col gap-6">
      {toc.map((group) => (
        <div key={group.section?.id ?? "none"}>
          {group.section && <p className="mb-2 text-[13px] text-ink-muted">{group.section.title}</p>}
          <ul className="border-l border-paper-line">
            {group.items.map((item) => {
              const active = item.id === currentId;
              const href = item.published || !canManage ? `/${orgSlug}/d/${item.id}` : `/${orgSlug}/d/${item.id}/dados`;
              return (
                <li key={item.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px flex items-baseline justify-between gap-3 border-l py-1 pl-3 pr-1 text-[15px] leading-snug transition-colors ${
                      active
                        ? "border-ink font-medium text-ink"
                        : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
                    }`}
                  >
                    <span className={item.published ? "" : "text-ink-muted"}>
                      {item.name}
                      {!item.published && <span className="ml-1.5 text-[11px] uppercase tracking-wide">· sem dados</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-muted">{item.number}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
