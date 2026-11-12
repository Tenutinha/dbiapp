"use client";

import { FilesLink } from "@/components/admin/FilesModal";
import { clientScopeOf } from "@/lib/storage-explorer";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { DataFilterPanel } from "../DataFilterPanel";
import { FilePickerDialog } from "./FilePickerDialog";
import { TableNode } from "./TableNode";
import type { ConnectorTable, Link as Wire } from "./types";
import { useConnector } from "./useConnector";

interface Point { x: number; y: number }

/** Smooth S-curve between the fact table's port and the data filter's socket. */
const curve = (a: Point, b: Point): string => {
  const dx = Math.max(40, (b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};

interface DataConnectorProps {
  instanceId: string;
  org: { slug: string; name: string };
  tables: ConnectorTable[];
  /** The space's folder (e.g. clientes/martinello), relative to the organization's storage folder. */
  initialFolder: string;
  canUpload: boolean;
}

/**
 * The "engate": what the dashboard needs (one card per contract table) and the fact table's data filter.
 * Only relates files: they are sent and organized in the "Arquivos" explorer, and each table chooses its
 * stored file(s) there ("Escolher arquivos": several files feed the same table, one converted file each).
 * The server checks the columns of every file before "Engatar" converts them into the draft.
 */
export function DataConnector({ instanceId, org, tables, initialFolder, canUpload }: DataConnectorProps) {
  const c = useConnector(instanceId, initialFolder);
  const box = useRef<HTMLDivElement>(null);
  const factOut = useRef<HTMLElement | null>(null);
  const filterIn = useRef<HTMLElement | null>(null);
  const [wire, setWire] = useState<{ a: Point; b: Point } | null>(null);
  const [filterRules, setFilterRules] = useState(0);
  const [choosing, setChoosing] = useState<string | null>(null);

  const measure = useCallback(() => {
    const o = box.current?.getBoundingClientRect();
    const at = (el: HTMLElement | null): Point | null => {
      if (!o || !el?.isConnected) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
    };
    const a = at(factOut.current);
    const b = at(filterIn.current);
    setWire(a && b ? { a, b } : null);
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, c.links, filterRules]);

  const factTable = tables.find((t) => t.kind === "fact");
  const linkOf = (table: string): Wire | undefined => c.links.find((l) => l.table === table);
  const engagedCount = tables.filter((t) => linkOf(t.name)?.phase === "engaged").length;
  const suggested = c.links.filter((l) => l.phase === "suggested");
  const ready = c.links.filter((l) => l.phase === "ok");

  /** One after the other: each engage downloads and converts a file on the server. */
  async function engageAll(): Promise<void> {
    for (const l of ready) await c.engage(l);
  }

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold">Engate dos dados</h3>
          <p className="text-xs text-muted">
            Relacione cada tabela a um ou mais arquivos já guardados no armazenamento (vários arquivos do mesmo layout, como um
            por ano, alimentam a mesma tabela); conferimos as colunas de cada um antes de engatar. Para
            enviar ou organizar arquivos, use o explorador:{" "}
            <FilesLink orgSlug={org.slug} folder={initialFolder} scope={clientScopeOf(initialFolder)} className="font-semibold text-brand-2 hover:underline">📁 Arquivos ↗</FilesLink>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engagedCount > 0 && <span className="rounded-full bg-ok/15 px-3 py-1 text-xs font-semibold text-ok">{engagedCount}/{tables.length} engatadas nesta sessão</span>}
          {suggested.length > 0 && (
            <button type="button" onClick={() => suggested.forEach((l) => c.connect(l.table, l.files))} className="btn btn-ghost px-3 py-1.5 text-xs">
              Verificar {suggested.length} sugest{suggested.length === 1 ? "ão" : "ões"}
            </button>
          )}
          {ready.length > 1 && (
            <button type="button" onClick={() => void engageAll()} className="btn btn-primary px-3 py-1.5 text-xs">⚡ Engatar {ready.length} prontas</button>
          )}
        </div>
      </header>

      <div className="-mx-5 overflow-x-auto px-5 pb-2">
        <div ref={box} className="relative grid min-w-[760px] grid-cols-[minmax(320px,1.2fr)_64px_minmax(330px,1fr)]">
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden>
            {wire && (
              <path d={curve(wire.a, wire.b)} fill="none"
                stroke={filterRules > 0 ? "var(--color-brand)" : "var(--color-muted)"} strokeWidth={filterRules > 0 ? 2.5 : 1.5}
                strokeDasharray={filterRules > 0 ? undefined : "5 5"} strokeLinecap="round" />
            )}
          </svg>

          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">O que o dashboard precisa</p>
            <p className="mb-3 text-[11px] text-muted">
              {tables.filter((t) => t.kind === "fact").length} fato(s) · {tables.filter((t) => t.kind === "dimension").length} dimensão(ões)
              {c.error ? ` · ${c.error}` : ""}
            </p>
            <div className="flex flex-col gap-3">
              {tables.map((t) => (
                <TableNode
                  key={t.name}
                  table={t}
                  link={linkOf(t.name)}
                  canUpload={canUpload}
                  outPortRef={t === factTable ? (el) => { factOut.current = el; } : undefined}
                  filtered={filterRules > 0}
                  onChooseFile={() => setChoosing(t.name)}
                  onEngage={(l) => void c.engage(l)}
                  onRetry={(l) => c.connect(l.table, l.files.filter((f) => f.state !== "ok"))}
                  onRemoveFile={(f) => c.remove(t.name, f)}
                  onDisconnect={() => c.disconnect(t.name)}
                />
              ))}
            </div>
          </div>

          <div aria-hidden />

          <div className="relative min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Filtro da tabela fato</p>
            <p className="mb-3 text-[11px] text-muted">
              {filterRules > 0 ? `${filterRules} regra(s) ativa(s) sobre ${factTable?.name ?? "a fato"}` : `Opcional: recorte quais linhas de ${factTable?.name ?? "a fato"} o dashboard mostra`}
            </p>
            <div className="relative">
              <span
                ref={(el) => { filterIn.current = el; }}
                className={`absolute -left-[7px] top-6 z-20 size-3 rounded-full border-2 bg-bg ${filterRules > 0 ? "border-brand bg-brand" : "border-line"}`}
                aria-hidden
              />
              <DataFilterPanel instanceId={instanceId} canEdit={canUpload} onSavedRules={setFilterRules} />
            </div>
          </div>
        </div>
      </div>

      {choosing && (
        <FilePickerDialog
          org={org}
          table={choosing}
          folder={initialFolder}
          onClose={() => {
            setChoosing(null);
            c.reload(); // files may have been added in the explorer: fresh name suggestions
          }}
          onPick={(picks) => c.connect(choosing, picks)}
        />
      )}
    </section>
  );
}
