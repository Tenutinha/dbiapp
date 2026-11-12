import Link from "next/link";
import { joinQuery, statusQuery, type StatusFilter as Filter } from "@/lib/controle/status";

interface StatusFilterProps {
  /** The screen's own address (/<org>/<cliente>/controle). */
  base: string;
  /** The period part of the address, kept when the filter changes. */
  periodQuery: string;
  status: Filter;
  /** How many entries of the period are still pending (shown on its chip). */
  pending: number;
}

const OPTIONS: { value: Filter; label: string }[] = [
  { value: null, label: "Todos" },
  { value: "efetivado", label: "Efetivados" },
  { value: "pendente", label: "Pendentes" },
];

/** Which entries the screen counts: all of them, only the confirmed ones or only those still pending. */
export function StatusFilter({ base, periodQuery, status, pending }: StatusFilterProps) {
  return (
    <nav aria-label="Situação dos lançamentos" className="flex gap-1.5 overflow-x-auto">
      {OPTIONS.map((option) => {
        const on = option.value === status;
        const query = joinQuery(periodQuery, statusQuery(option.value));
        return (
          <Link
            key={option.label}
            href={query ? `${base}?${query}` : base}
            aria-current={on ? "true" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              on ? "border-brand bg-brand/15 font-semibold" : "border-line text-muted hover:bg-text/5"
            }`}
          >
            {option.label}
            {option.value === "pendente" && pending > 0 && (
              <span className="rounded-full bg-accent/20 px-1.5 text-xs font-semibold tabular-nums text-text">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
