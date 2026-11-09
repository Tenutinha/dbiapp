"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { DataFilterPanel } from "../DataFilterPanel";
import { TableNode } from "./TableNode";
import type { ConnectorTable, Link, LinkPhase } from "./types";
import { UploadStep } from "./UploadStep";
import { useConnector } from "./useConnector";

interface Point { x: number; y: number }

const WIRE: Record<LinkPhase, { stroke: string; width: number; dash?: string; flow?: boolean }> = {
  suggested: { stroke: "var(--color-muted)", width: 1.5, dash: "5 5" },
  checking: { stroke: "var(--color-brand-2)", width: 2, flow: true },
  ok: { stroke: "var(--color-ok)", width: 2.5 },
  diverge: { stroke: "var(--color-danger)", width: 2.5, dash: "7 4" },
  engaging: { stroke: "var(--color-brand)", width: 3, flow: true },
  engaged: { stroke: "var(--color-ok)", width: 3.5 },
  failed: { stroke: "var(--color-danger)", width: 2, dash: "3 4" },
};

/** Smooth S-curve between a file's port (left) and a table's socket (right). */
const curve = (a: Point, b: Point): string => {
  const dx = Math.max(40, (b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};

function FolderBar({ folder, folders, onOpen }: { folder: string; folders: string[]; onOpen: (f: string) => void }) {
  const parts = folder.split("/").filter(Boolean);
  return (
    <div className="mb-3 flex flex-col gap-2">
      <nav aria-label="Pasta" className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
        <button type="button" onClick={() => onOpen("")} className="text-muted hover:text-text">armazenamento</button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-muted">/</span>
            <button type="button" onClick={() => onOpen(parts.slice(0, i + 1).join("/"))} className="hover:text-brand-2">{p}</button>
          </span>
        ))}
      </nav>
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {folders.map((f) => (
            <button key={f} type="button" onClick={() => onOpen([folder, f].filter(Boolean).join("/"))} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-brand/60 hover:text-text">
              📁 {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DataConnectorProps {
  instanceId: string;
  tables: ConnectorTable[];
  /** Folder opened first (e.g. preparado/presidente), relative to the organization's storage folder. */
  initialFolder: string;
  canUpload: boolean;
}

/**
 * The "engate" map (BPMN-like): files of an organization folder on the left, the dashboard's contract
 * tables on the right. Drag a file's port onto a table (or click file, then table) to wire them: the
 * server checks the columns, the wire turns green or red, and "Engatar" converts the file into the draft.
 * Each table's plug uploads a file from the computer straight into it.
 */
export function DataConnector({ instanceId, tables, initialFolder, canUpload }: DataConnectorProps) {
  const c = useConnector(instanceId, initialFolder);
  const box = useRef<HTMLDivElement>(null);
  const filePorts = useRef(new Map<string, HTMLElement>());
  const tablePorts = useRef(new Map<string, HTMLElement>());
  const factOut = useRef<HTMLElement | null>(null);
  const filterIn = useRef<HTMLElement | null>(null);
  const [points, setPoints] = useState<{ files: Map<string, Point>; tables: Map<string, Point>; factOut?: Point; filterIn?: Point }>({ files: new Map(), tables: new Map() });
  const [filterRules, setFilterRules] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ file: string; at: Point } | null>(null);
  /** Names stored by the Upload step in this session (highlighted in the folder). */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const center = useCallback((el: HTMLElement): Point => {
    const o = box.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
  }, []);

  const measure = useCallback(() => {
    if (!box.current) return;
    const map = (refs: Map<string, HTMLElement>) => new Map([...refs].filter(([, el]) => el.isConnected).map(([k, el]) => [k, center(el)]));
    const at = (el: HTMLElement | null): Point | undefined => (el?.isConnected ? center(el) : undefined);
    setPoints({ files: map(filePorts.current), tables: map(tablePorts.current), factOut: at(factOut.current), filterIn: at(filterIn.current) });
  }, [center]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, c.data, c.links, filterRules]);

  function connect(file: string, table: string): void {
    setPicked(null);
    void c.connect(file, table);
  }

  function onPointerUp(e: React.PointerEvent): void {
    if (!drag) return;
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-table]");
    const table = target?.dataset.table;
    setDrag(null);
    if (table) connect(drag.file, table);
  }

  /** A file stored by the Upload step: highlight it and list the folder again (once for a burst of files). */
  function stored(name: string): void {
    setFresh((prev) => new Set(prev).add(name));
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(c.reload, 500);
  }

  const factTable = tables.find((t) => t.kind === "fact");
  const files = c.data?.files ?? [];
  const linkOf = (table: string): Link | undefined => c.links.find((l) => l.table === table);
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
            Arraste um arquivo até a tabela que ele alimenta (ou clique no arquivo e depois na tabela). Conferimos as
            colunas antes de engatar. Comece pelo upload: os arquivos do seu computador ficam guardados na pasta aberta do
            armazenamento. A tomada de cada tabela envia um arquivo direto para ela.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engagedCount > 0 && <span className="rounded-full bg-ok/15 px-3 py-1 text-xs font-semibold text-ok">{engagedCount}/{tables.length} engatadas nesta sessão</span>}
          {suggested.length > 0 && (
            <button type="button" onClick={() => suggested.forEach((l) => connect(l.file, l.table))} className="btn btn-ghost px-3 py-1.5 text-xs">
              Verificar {suggested.length} sugest{suggested.length === 1 ? "ão" : "ões"}
            </button>
          )}
          {ready.length > 1 && (
            <button type="button" onClick={() => void engageAll()} className="btn btn-primary px-3 py-1.5 text-xs">⚡ Engatar {ready.length} prontas</button>
          )}
        </div>
      </header>

      {/* Steps (upload → files → tables → data filter); scrolls sideways when the space is narrow. */}
      <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div
        ref={box}
        onPointerMove={(e) => drag && setDrag({ file: drag.file, at: { x: e.clientX - box.current!.getBoundingClientRect().left, y: e.clientY - box.current!.getBoundingClientRect().top } })}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setDrag(null)}
        className={`relative grid ${canUpload
          ? "min-w-[1400px] grid-cols-[minmax(230px,1fr)_40px_minmax(220px,1fr)_80px_minmax(300px,1.2fr)_64px_minmax(330px,1.2fr)]"
          : "min-w-[1120px] grid-cols-[minmax(220px,1fr)_80px_minmax(300px,1.2fr)_64px_minmax(330px,1.2fr)]"} ${drag ? "cursor-grabbing select-none" : ""}`}
      >
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden>
          {points.factOut && points.filterIn && (
            <path d={curve(points.factOut, points.filterIn)} fill="none"
              stroke={filterRules > 0 ? "var(--color-brand)" : "var(--color-muted)"} strokeWidth={filterRules > 0 ? 2.5 : 1.5}
              strokeDasharray={filterRules > 0 ? undefined : "5 5"} strokeLinecap="round" />
          )}
          {c.links.map((l) => {
            const a = points.files.get(l.file);
            const b = points.tables.get(l.table);
            if (!a || !b || l.uploaded) return null;
            const w = WIRE[l.phase];
            return (
              <path key={l.table} d={curve(a, b)} fill="none" stroke={w.stroke} strokeWidth={w.width} strokeLinecap="round"
                strokeDasharray={w.dash} className={w.flow ? "dbi-wire-flow" : undefined} />
            );
          })}
          {drag && points.files.get(drag.file) && (
            <path d={curve(points.files.get(drag.file)!, drag.at)} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeDasharray="6 4" className="dbi-wire-flow" />
          )}
        </svg>

        {/* Step 1: send files from the computer to the open folder */}
        {canUpload && (
          <>
            <UploadStep instanceId={instanceId} folder={c.folder} onStored={stored} />
            <div aria-hidden className="flex items-start justify-center pt-16 text-xl text-muted">→</div>
          </>
        )}

        {/* Files of the folder */}
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{canUpload ? "2 · " : ""}Arquivos no armazenamento</p>
          <FolderBar folder={c.folder} folders={c.data?.folders ?? []} onOpen={(f) => { setPicked(null); c.setFolder(f); }} />
          {c.loading && <p className="animate-pulse text-xs text-muted">Lendo a pasta…</p>}
          {c.error && <p className="text-xs text-danger">{c.error}</p>}
          {!c.loading && !c.error && files.length === 0 && <p className="text-xs text-muted">Pasta vazia. Faça o upload dos arquivos, abra uma subpasta ou use a tomada de cada tabela.</p>}
          <ul className="flex flex-col gap-2">
            {files.filter((f) => f.engageable).map((f) => {
              const wired = c.links.filter((l) => l.file === f.name && !l.uploaded);
              const active = picked === f.name || drag?.file === f.name;
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => setPicked(picked === f.name ? null : f.name)}
                    className={`relative flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition ${active ? "border-brand ring-2 ring-brand/30" : wired.length ? "border-ok/50" : fresh.has(f.name) ? "border-brand/60 bg-brand/5" : "border-line hover:border-brand/50"}`}
                  >
                    <span className="text-base" aria-hidden>{f.name.toLowerCase().endsWith(".parquet") ? "🧊" : "📄"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs font-medium" title={f.name}>{f.name}</span>
                      <span className="block text-[10px] text-muted">{formatBytes(f.sizeBytes)}{fresh.has(f.name) ? " · novo" : ""}{wired.length ? ` · → ${wired.map((w) => w.table).join(", ")}` : ""}</span>
                    </span>
                    <span
                      ref={(el) => { if (el) filePorts.current.set(f.name, el); else filePorts.current.delete(f.name); }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const o = box.current!.getBoundingClientRect();
                        setDrag({ file: f.name, at: { x: e.clientX - o.left, y: e.clientY - o.top } });
                      }}
                      title="Arraste até uma tabela"
                      className={`absolute -right-[8px] top-1/2 z-20 size-4 -translate-y-1/2 cursor-grab rounded-full border-2 bg-bg transition hover:scale-125 ${wired.length ? "border-ok bg-ok" : "border-brand"}`}
                    />
                  </button>
                </li>
              );
            })}
            {files.some((f) => !f.engageable) && (
              <li className="mt-1 text-[11px] text-muted">Guardados (só .parquet, .csv e .txt podem ser engatados):</li>
            )}
            {files.filter((f) => !f.engageable).map((f) => (
              <li key={f.name} className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-muted ${fresh.has(f.name) ? "border-brand/60 bg-brand/5" : "border-line"}`}>
                <span aria-hidden>🗂</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={f.name}>{f.name}</span>
                <span className="text-[10px]">{formatBytes(f.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div aria-hidden />

        {/* Right: what the dashboard needs */}
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{canUpload ? "3 · " : ""}O que o dashboard precisa</p>
          <p className="mb-3 text-[11px] text-muted">
            {picked ? <>Agora clique na tabela que <b className="font-mono">{picked}</b> alimenta.</> : `${tables.filter((t) => t.kind === "fact").length} fato(s) · ${tables.filter((t) => t.kind === "dimension").length} dimensão(ões)`}
          </p>
          <div className="flex flex-col gap-3">
            {tables.map((t) => (
              <TableNode
                key={t.name}
                table={t}
                link={linkOf(t.name)}
                awaiting={picked !== null || drag !== null}
                canUpload={canUpload}
                portRef={(el) => { if (el) tablePorts.current.set(t.name, el); else tablePorts.current.delete(t.name); }}
                outPortRef={t === factTable ? (el) => { factOut.current = el; } : undefined}
                filtered={filterRules > 0}
                onPick={() => picked && connect(picked, t.name)}
                onEngage={(l) => void c.engage(l)}
                onRetry={(l) => connect(l.file, l.table)}
                onDisconnect={() => c.disconnect(t.name)}
                onUpload={(file) => void c.upload(t.name, file)}
              />
            ))}
          </div>
        </div>

        <div aria-hidden />

        {/* Far right: the data filter, wired to the fact table */}
        <div className="relative min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{canUpload ? "4 · " : ""}Filtro da tabela fato</p>
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
    </section>
  );
}
