"use client";

import { useFormStatus } from "react-dom";
import { openDashboardAction } from "./view-actions";

interface DashboardNavItemProps {
  id: string;
  name: string;
  number: number;
  active: boolean;
}

function ItemButton({ name, number, active }: Omit<DashboardNavItemProps, "id">) {
  const { pending } = useFormStatus();
  return (
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
  );
}

/** One dashboard in the viewing sidebar: opens it without changing the page address. */
export function DashboardNavItem({ id, ...rest }: DashboardNavItemProps) {
  return (
    <form action={openDashboardAction}>
      <input type="hidden" name="id" value={id} />
      <ItemButton {...rest} />
    </form>
  );
}
