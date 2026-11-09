"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useRef, useState, useTransition } from "react";
import { linkDashboardAction } from "@/app/[org]/admin/dashboard-actions";
import { areaHues, areasOf, filterPickerItems, groupByArea, type PickerItem } from "@/lib/catalog-picker";
import { PickerDetail } from "./PickerDetail";
import { Poster } from "./Poster";

interface Target {
  /** "org" or the client's id. */
  scope: string;
  spaceName: string;
  /** Catalog ids this space already has. */
  linked: ReadonlySet<string>;
}

const PickerContext = createContext<((t: Target) => void) | null>(null);

function Card({ item, hue, active, linked, onSelect }: { item: PickerItem; hue: number; active: boolean; linked: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group/card relative w-56 shrink-0 snap-start rounded-xl text-left outline-none transition duration-200 hover:z-10 hover:scale-[1.06] focus-visible:scale-[1.06] ${active ? "ring-2 ring-brand ring-offset-2 ring-offset-bg" : ""}`}
    >
      <Poster item={item} hue={hue} className="shadow-lg shadow-black/20 group-hover/card:shadow-2xl" />
      {linked && (
        <span className="absolute right-2 top-2 rounded-full bg-ok px-1.5 py-0.5 text-[10px] font-bold text-white">✓ no espaço</span>
      )}
      <span className="mt-1.5 block truncate text-[11px] text-muted">
        {item.analyses.length > 0 ? `${item.analyses.length} análises · ` : ""}{item.visualCount} visuais
      </span>
    </button>
  );
}

function Row({ title, items, children }: { title: string; items: number; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h4 className="mb-2 text-sm font-bold">
        {title} <span className="font-normal text-muted">· {items}</span>
      </h4>
      <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-3 pt-2">{children}</div>
    </section>
  );
}

interface PickerDialogProps {
  orgSlug: string;
  items: PickerItem[];
  target: Target;
  onClose: () => void;
}

function PickerDialog({ orgSlug, items, target, onClose }: PickerDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const firstNew = items.find((i) => !target.linked.has(i.id)) ?? items[0];
  const [selectedId, setSelectedId] = useState(firstNew?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const areas = useMemo(() => areasOf(items), [items]);
  const hues = useMemo(() => areaHues(items), [items]);
  const hueOf = (i: PickerItem): number => hues.get(i.area) ?? 262;
  const results = useMemo(() => filterPickerItems(items, query, area), [items, query, area]);
  const browsing = query.trim() === "" && area === null;
  // While searching or filtering, the featured dashboard follows the results (first one if the chosen one left).
  const pool = browsing ? items : results;
  const selected = pool.find((i) => i.id === selectedId) ?? pool[0] ?? null;

  function select(id: string): void {
    setSelectedId(id);
    setError(null);
    heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function add(item: PickerItem): void {
    const form = new FormData();
    form.set("org", orgSlug);
    form.set("scope", target.scope);
    form.set("templateId", item.id);
    start(async () => {
      const res = await linkDashboardAction({ ok: false, message: "" }, form);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.refresh();
      dialogRef.current?.close();
    });
  }

  const card = (i: PickerItem) => (
    <Card key={i.id} item={i} hue={hueOf(i)} active={i.id === selected?.id} linked={target.linked.has(i.id)} onSelect={() => select(i.id)} />
  );

  return (
    <dialog
      ref={(el) => {
        dialogRef.current = el;
        if (el && !el.open) el.showModal();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      aria-label={`Escolher dashboard para ${target.spaceName}`}
      className="m-auto h-[min(860px,calc(100vh-2rem))] w-[min(1180px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-bg p-0 text-text shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
          <div className="mr-auto min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-2">Catálogo DBI · {items.length} dashboards</p>
            <h2 className="truncate text-lg font-bold">Escolha um dashboard para {target.spaceName}</h2>
          </div>
          <label className="relative w-full sm:w-80">
            <span className="sr-only">Pesquisar dashboards</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar por nome, assunto ou análise…"
              className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-text/5 hover:text-text">
            ×
          </button>
          <nav aria-label="Assuntos" className="flex w-full gap-1.5 overflow-x-auto">
            {[null, ...areas].map((a) => (
              <button
                key={a ?? "todos"}
                type="button"
                onClick={() => setArea(a)}
                aria-pressed={area === a}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${area === a ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:border-brand/60 hover:text-text"}`}
              >
                {a ?? "Todos"}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div ref={heroRef} className="scroll-mt-4">
            {selected ? (
              <PickerDetail
                item={selected}
                hue={hueOf(selected)}
                spaceName={target.spaceName}
                linked={target.linked.has(selected.id)}
                pending={pending}
                error={error}
                onAdd={() => add(selected)}
              />
            ) : items.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">O catálogo ainda não tem dashboards publicados.</p>
            ) : null}
          </div>

          {browsing ? (
            groupByArea(items).map(([a, list]) => (
              <Row key={a} title={a} items={list.length}>{list.map(card)}</Row>
            ))
          ) : results.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted">Nenhum dashboard encontrado para “{query.trim() || area}”.</p>
          ) : (
            <Row title={query.trim() ? `Resultados para “${query.trim()}”` : (area ?? "")} items={results.length}>
              {results.map(card)}
            </Row>
          )}
        </div>
      </div>
    </dialog>
  );
}

interface CatalogPickerProviderProps {
  orgSlug: string;
  /** Every published catalog dashboard (sent once for the whole table). */
  items: PickerItem[];
  children: React.ReactNode;
}

/** Holds the catalog once for the admin table; any "+ Adicionar dashboard" opens the picker for its space. */
export function CatalogPickerProvider({ orgSlug, items, children }: CatalogPickerProviderProps) {
  const [target, setTarget] = useState<Target | null>(null);
  return (
    <PickerContext.Provider value={setTarget}>
      {children}
      {target && <PickerDialog orgSlug={orgSlug} items={items} target={target} onClose={() => setTarget(null)} />}
    </PickerContext.Provider>
  );
}

interface AddDashboardButtonProps {
  scope: string;
  spaceName: string;
  linkedIds: string[];
}

/** Column "Dashboard", last row of a space: opens the catalog picker for that space. */
export function AddDashboardButton({ scope, spaceName, linkedIds }: AddDashboardButtonProps) {
  const open = useContext(PickerContext);
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => open({ scope, spaceName, linked: new Set(linkedIds) })}
      className="text-xs text-muted hover:text-brand-2"
    >
      + Adicionar dashboard
    </button>
  );
}
