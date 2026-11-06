"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export interface FilterBarProps {
  filters: { fieldId: string; label: string; values: string[]; selected: string[] }[];
}

function FilterDropdown({
  filter, onChange,
}: { filter: FilterBarProps["filters"][number]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const visible = filter.values.filter((v) => v.toLowerCase().includes(query.toLowerCase())).slice(0, 200);
  const toggle = (v: string): void =>
    onChange(filter.selected.includes(v) ? filter.selected.filter((s) => s !== v) : [...filter.selected, v]);
  const active = filter.selected.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
          active ? "border-brand bg-brand/15 text-text" : "border-line text-muted hover:text-text"
        }`}
      >
        {filter.label}
        {active && <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs text-on-brand">{filter.selected.length}</span>}
        <span className="ml-1.5 text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-64 rounded-xl border border-line bg-card-2 p-2 shadow-2xl">
          {filter.values.length > 8 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="mb-2 w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          )}
          <ul className="max-h-64 overflow-auto">
            {visible.map((v) => (
              <li key={v}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
                  <input type="checkbox" checked={filter.selected.includes(v)} onChange={() => toggle(v)} className="accent-brand" />
                  {v}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Nada encontrado</li>}
          </ul>
          {active && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-brand-2 hover:bg-white/5">
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ filters }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function apply(fieldId: string, values: string[]): void {
    const next = new URLSearchParams(params.toString());
    next.delete(`f.${fieldId}`);
    values.forEach((v) => next.append(`f.${fieldId}`, v));
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const anyActive = filters.some((f) => f.selected.length > 0);

  return (
    <div className={`mb-6 flex flex-wrap items-center gap-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
      {filters.map((f) => (
        <FilterDropdown key={f.fieldId} filter={f} onChange={(values) => apply(f.fieldId, values)} />
      ))}
      {anyActive && (
        <button
          type="button"
          onClick={() => start(() => router.replace(pathname, { scroll: false }))}
          className="px-2 text-sm text-brand-2 hover:underline"
        >
          Limpar filtros
        </button>
      )}
      {pending && <span className="text-xs text-muted">atualizando…</span>}
    </div>
  );
}
