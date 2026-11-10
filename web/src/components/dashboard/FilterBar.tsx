"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CROSS_PREFIX, crossKey } from "@/lib/query/cross";

export interface FilterBarProps {
  filters: { fieldId: string; label: string; values: string[]; selected: string[]; single: boolean }[];
  /** Items picked in the visuals (cross-filtering), shown as removable chips. */
  cross?: { visualId: string; fieldId: string; label: string; visualTitle: string; values: string[] }[];
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
  const toggle = (v: string): void => {
    if (filter.single) {
      setOpen(false);
      onChange([v]);
      return;
    }
    onChange(filter.selected.includes(v) ? filter.selected.filter((s) => s !== v) : [...filter.selected, v]);
  };
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
        {filter.single ? (
          <span className="ml-1.5 font-semibold text-text">{filter.selected[0]}</span>
        ) : (
          active && <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs text-on-brand">{filter.selected.length}</span>
        )}
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
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-text/5">
                  <input
                    type={filter.single ? "radio" : "checkbox"}
                    name={filter.single ? `filtro-${filter.fieldId}` : undefined}
                    checked={filter.selected.includes(v)}
                    onChange={() => toggle(v)}
                    className="accent-brand"
                  />
                  {v}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Nada encontrado</li>}
          </ul>
          {active && !filter.single && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-brand-2 hover:bg-text/5">
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A value in use, shown as a removable chip. */
function Chip({ label, value, title, onRemove }: { label: string; value: string; title?: string; onRemove?: () => void }) {
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/40 bg-brand/10 py-0.5 pl-2.5 pr-1 text-xs">
      <span className="text-muted">{label}:</span>
      <span className="max-w-56 truncate font-medium">{value}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remover ${label}: ${value}`} className="rounded-full px-1 text-muted hover:bg-text/10 hover:text-text">
          ×
        </button>
      ) : (
        <span className="pr-1" />
      )}
    </span>
  );
}

/** Up to three values by name, then how many more ("Sul, Norte, Leste +2"). */
function summarize(values: readonly string[]): string {
  const head = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${head} +${values.length - 3}` : head;
}

/** Remembers, per browser, whether the reader keeps the filter area open. */
const OPEN_KEY = "dbi:filtros-abertos";

/**
 * The filter area of a dashboard: every filter the dashboard offers, in a panel that opens and closes.
 * Closed, it still shows what is in use — the chosen filters and the items picked in the visuals
 * (cross-filtering) — each removable on its own.
 */
export function FilterBar({ filters, cross = [] }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    } catch {
      // Storage blocked (private window): the panel just starts open.
    }
  }, []);

  function toggleOpen(): void {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, nothing else to do.
    }
  }

  function go(next: URLSearchParams): void {
    const query = next.toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function apply(fieldId: string, values: string[]): void {
    const next = new URLSearchParams(params.toString());
    next.delete(`f.${fieldId}`);
    values.forEach((v) => next.append(`f.${fieldId}`, v));
    go(next);
  }

  function removePick(visualId: string, fieldId: string): void {
    const next = new URLSearchParams(params.toString());
    next.delete(crossKey(visualId, fieldId));
    go(next);
  }

  /** Back to the dashboard as it opens: no filter, no picked item (single-choice filters return to their default). */
  function clearAll(): void {
    go(new URLSearchParams([...params.entries()].filter(([k]) => !k.startsWith("f.") && !k.startsWith(CROSS_PREFIX))));
  }

  const chosen = filters.filter((f) => !f.single && f.selected.length > 0);
  const singles = filters.filter((f) => f.single && f.selected.length > 0);
  const activeCount = chosen.length + cross.length;
  if (filters.length === 0 && cross.length === 0) return null;

  return (
    <section aria-label="Filtros" className={`card mb-6 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls="painel-filtros"
          className="inline-flex items-center gap-2 text-sm font-medium hover:text-brand-2"
        >
          <span aria-hidden className={`text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          Filtros
          {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-on-brand">{activeCount}</span>}
        </button>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {!open && singles.map((f) => <Chip key={f.fieldId} label={f.label} value={f.selected[0]} />)}
          {!open && chosen.map((f) => (
            <Chip key={f.fieldId} label={f.label} value={summarize(f.selected)} title={f.selected.join(", ")} onRemove={() => apply(f.fieldId, [])} />
          ))}
          {cross.map((c) => (
            <Chip
              key={`${c.visualId}.${c.fieldId}`}
              label={c.label}
              value={summarize(c.values)}
              title={`Selecionado em "${c.visualTitle}": ${c.values.join(", ")}`}
              onRemove={() => removePick(c.visualId, c.fieldId)}
            />
          ))}
          {!open && activeCount === 0 && singles.length === 0 && <span className="text-xs text-muted">Nenhum filtro em uso</span>}
        </div>

        {pending && <span className="text-xs text-muted">atualizando…</span>}
        {activeCount > 0 && (
          <button type="button" onClick={clearAll} className="text-sm text-brand-2 hover:underline">
            Limpar tudo
          </button>
        )}
      </div>

      {open && (
        <div id="painel-filtros" className="border-t border-line px-4 py-3">
          {filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {filters.map((f) => (
                <FilterDropdown key={f.fieldId} filter={f} onChange={(values) => apply(f.fieldId, values)} />
              ))}
            </div>
          )}
          <p className={`text-xs text-muted ${filters.length > 0 ? "mt-3" : ""}`}>
            Clique em um item de um gráfico, mapa ou tabela para filtrar os outros visuais por ele; Ctrl + clique soma itens e
            um novo clique no item desfaz. Duplo clique no cabeçalho de uma coluna classifica a tabela.
          </p>
        </div>
      )}
    </section>
  );
}
