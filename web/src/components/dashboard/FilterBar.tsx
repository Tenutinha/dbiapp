"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CROSS_PREFIX, crossKey } from "@/lib/query/cross";

type Filter = { fieldId: string; label: string; values: string[]; selected: string[]; single: boolean };

export interface FilterBarProps {
  filters: Filter[];
  /** Items picked in the visuals (cross-filtering), shown as removable chips. */
  cross?: { visualId: string; fieldId: string; label: string; visualTitle: string; values: string[] }[];
}

/** Options drawn per filter; the search box reaches the rest. */
const MAX_OPTIONS = 200;

/** One filter of the side panel: its values as a searchable list, always in sight (no dropdown). */
function FilterSection({ filter, onChange }: { filter: Filter; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState("");
  const visible = filter.values.filter((v) => v.toLowerCase().includes(query.toLowerCase())).slice(0, MAX_OPTIONS);
  const toggle = (v: string): void => {
    if (filter.single) onChange([v]);
    else onChange(filter.selected.includes(v) ? filter.selected.filter((s) => s !== v) : [...filter.selected, v]);
  };
  const active = !filter.single && filter.selected.length > 0;

  return (
    <details open className="group border-b border-line last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-text/5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-[10px] text-muted transition-transform group-open:rotate-90">▶</span>
        <span className="min-w-0 flex-1 truncate">{filter.label}</span>
        {filter.single ? (
          <span className="max-w-32 truncate text-xs font-semibold text-brand-2">{filter.selected[0]}</span>
        ) : (
          active && <span className="rounded-full bg-brand px-1.5 text-xs text-on-brand">{filter.selected.length}</span>
        )}
      </summary>
      <div className="px-4 pb-3">
        {filter.values.length > 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            aria-label={`Buscar em ${filter.label}`}
            className="mb-2 w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
        )}
        <ul className="scroll-quiet max-h-52 overflow-auto">
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
                <span className="min-w-0 truncate" title={v}>{v}</span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Nada encontrado</li>}
        </ul>
        {active && (
          <button type="button" onClick={() => onChange([])} className="mt-1 rounded-md px-2 py-1 text-xs text-brand-2 hover:bg-text/5">
            Limpar seleção
          </button>
        )}
      </div>
    </details>
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

function FunnelIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3z" />
    </svg>
  );
}

/**
 * The filters of a dashboard. A floating "Filtros" button stays in the bottom-left corner of the screen
 * and opens, right above it, a floating panel listing every filter the dashboard offers. The panel does
 * not block the page, so the visuals can be watched — and clicked — while filtering. On the page itself
 * there is only what is in use (chosen filters and the items picked in the visuals, each removable).
 */
export function FilterBar({ filters, cross = [] }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

  const picks = cross.map((c) => (
    <Chip
      key={`${c.visualId}.${c.fieldId}`}
      label={c.label}
      value={summarize(c.values)}
      title={`Selecionado em "${c.visualTitle}": ${c.values.join(", ")}`}
      onRemove={() => removePick(c.visualId, c.fieldId)}
    />
  ));

  return (
    <>
      {(singles.length > 0 || activeCount > 0) && (
        <div className={`mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {singles.map((f) => <Chip key={f.fieldId} label={f.label} value={f.selected[0]} />)}
            {chosen.map((f) => (
              <Chip key={f.fieldId} label={f.label} value={summarize(f.selected)} title={f.selected.join(", ")} onRemove={() => apply(f.fieldId, [])} />
            ))}
            {picks}
          </div>
          {pending && <span className="text-xs text-muted">atualizando…</span>}
          {activeCount > 0 && (
            <button type="button" onClick={clearAll} className="text-sm text-brand-2 hover:underline">
              Limpar tudo
            </button>
          )}
        </div>
      )}

      {/* Always on screen, like the "Inspecionar" button of the opposite corner (same box, mirrored). */}
      <div className="fixed bottom-16 left-3 z-40 flex items-center gap-2 rounded-xl border border-brand/40 bg-card-2/95 px-2 py-1.5 text-xs shadow-2xl backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="painel-filtros"
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold transition ${
            open ? "bg-brand text-on-brand" : "text-brand hover:bg-brand/15"
          }`}
        >
          <FunnelIcon />
          Filtros
          {activeCount > 0 && (
            <span className={`rounded-full px-1.5 ${open ? "bg-on-brand/25" : "bg-brand text-on-brand"}`}>{activeCount}</span>
          )}
        </button>
        {pending && <span className="pr-1 text-muted">atualizando…</span>}
      </div>

      {open && (
        <aside
          id="painel-filtros"
          aria-label="Filtros"
          // A floating card right above its button: clear of the top and the bottom of the page, as tall as its filters need.
          className="card fixed bottom-28 left-3 z-50 flex max-h-[calc(100vh-9rem)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <FunnelIcon />
            <h2 className="flex-1 text-sm font-semibold">Filtros</h2>
            {pending && <span className="text-xs text-muted">atualizando…</span>}
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar filtros" className="rounded-md px-2 py-0.5 text-lg leading-none text-muted hover:bg-text/10 hover:text-text">
              ×
            </button>
          </header>

          <div className="scroll-quiet min-h-0 flex-1 overflow-auto">
            {cross.length > 0 && (
              <div className="border-b border-line px-4 py-3">
                <p className="mb-2 text-xs text-muted">Selecionado nos visuais</p>
                <div className="flex flex-wrap gap-1.5">{picks}</div>
              </div>
            )}
            {filters.map((f) => (
              <FilterSection key={f.fieldId} filter={f} onChange={(values) => apply(f.fieldId, values)} />
            ))}
            <p className="px-4 py-3 text-xs leading-relaxed text-muted">
              Clique em um item de um gráfico, mapa ou tabela para filtrar os outros visuais por ele; Ctrl + clique soma itens e
              um novo clique no item desfaz. Duplo clique no cabeçalho de uma coluna classifica a tabela.
            </p>
          </div>

          <footer className="flex items-center justify-between border-t border-line px-4 py-3">
            <button type="button" onClick={clearAll} disabled={activeCount === 0} className="text-sm text-brand-2 hover:underline disabled:text-muted disabled:no-underline">
              Limpar tudo
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost rounded-full px-3.5 py-1.5 text-sm">
              Fechar
            </button>
          </footer>
        </aside>
      )}
    </>
  );
}
