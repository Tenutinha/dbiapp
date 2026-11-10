"use client";

import { useOpenDashboard } from "./switching";
import { openDashboardAction } from "./view-actions";

interface DashboardNavItemProps {
  id: string;
  name: string;
  number: number;
  active: boolean;
}

/**
 * One dashboard in the viewing sidebar: opens it without changing the page address. Another dashboard
 * shows its skeleton at once; reopening the one already on screen keeps it there while it reloads.
 * (The form is what works before the page's scripts load; after that the click is handled here.)
 */
export function DashboardNavItem({ id, name, number, active }: DashboardNavItemProps) {
  const { pending, open } = useOpenDashboard(name, !active);
  return (
    <form
      action={openDashboardAction}
      onSubmit={(e) => {
        e.preventDefault();
        open(id);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-current={active ? "page" : undefined}
        aria-busy={pending || undefined}
        className={`-ml-px flex w-full items-baseline justify-between gap-3 border-l py-1 pl-3 pr-1 text-left text-[15px] leading-snug transition-colors ${
          active || pending
            ? "border-ink font-medium text-ink"
            : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
        } ${pending ? "animate-pulse" : ""}`}
      >
        <span>{name}</span>
        <span className="shrink-0 tabular-nums text-ink-muted">{number}</span>
      </button>
    </form>
  );
}
