"use client";

import { useEffect, useState } from "react";
import { matchesQuery } from "@/lib/text-search";

/** One dashboard of the showcase: its rendered card and the text the search looks into. */
export interface VitrineEntry {
  id: string;
  text: string;
  node: React.ReactNode;
}

type View = "grid" | "list";

/** Remembered per browser; storage may be unavailable (private mode), so every access is guarded. */
const VIEW_KEY = "dbi:vitrine-visao";

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function saveView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // not persisted: the choice still holds for this visit
  }
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

const VIEWS: readonly { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "grid", label: "Grade", icon: <GridIcon /> },
  { id: "list", label: "Lista", icon: <ListIcon /> },
];

interface VitrineBrowserProps {
  entries: VitrineEntry[];
  /** Extra control at the right of the toolbar (e.g. the note on how new dashboards are made). */
  action?: React.ReactNode;
}

/**
 * The showcase's dashboards with a search, a grid/list switch and a height cap with its own scroll,
 * so a long catalog doesn't push the rest of the page down. Cards adapt to the list view through
 * the `in-data-[view=list]:` variants.
 */
export function VitrineBrowser({ entries, action }: VitrineBrowserProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  useEffect(() => setView(readView()), []);

  const shown = entries.filter((e) => matchesQuery(e.text, query));
  const pick = (next: View): void => {
    setView(next);
    saveView(next);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">Buscar dashboard</span>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, assunto, origem…"
            className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-brand"
          />
        </label>
        <span className="text-xs text-muted" aria-live="polite">
          {query.trim() ? `${shown.length} de ${entries.length}` : entries.length} {entries.length === 1 ? "dashboard" : "dashboards"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="Visualização" className="flex rounded-lg border border-line p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => pick(v.id)}
                aria-pressed={view === v.id}
                title={v.label}
                aria-label={v.label}
                className={`grid size-8 place-items-center rounded-md transition ${view === v.id ? "bg-brand/10 text-brand-2" : "text-muted hover:text-text"}`}
              >
                {v.icon}
              </button>
            ))}
          </div>
          {action}
        </div>
      </div>

      <div
        data-view={view}
        className={`max-h-[min(72vh,820px)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl p-1 ${
          view === "grid" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-2"
        }`}
      >
        {shown.map((e) => <div key={e.id} className="flex min-w-0 [&>*]:min-w-0 [&>*]:flex-1">{e.node}</div>)}
        {shown.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-muted">Nenhum dashboard encontrado para “{query.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
