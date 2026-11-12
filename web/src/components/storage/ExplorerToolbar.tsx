"use client";

import { useRef } from "react";
import { levelsFrom } from "@/lib/storage-explorer";
import { folderLabel } from "./ExplorerTree";

export type ViewMode = "details" | "icons";

/** Quick filter by what the files are ("all" shows everything). */
export type StatusFilter = "all" | "ready" | "treatment" | "outOfPlace" | "unknown";

const FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Todos os arquivos" },
  { id: "ready", label: "Prontos para engatar" },
  { id: "treatment", label: "Precisam de tratamento" },
  { id: "outOfPlace", label: "Fora da pasta padrão" },
  { id: "unknown", label: "Não reconhecidos" },
];

interface ExplorerToolbarProps {
  folder: string;
  orgName: string;
  clientNames: ReadonlyMap<string, string>;
  canBack: boolean;
  canForward: boolean;
  query: string;
  view: ViewMode;
  busy: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onOpen: (path: string) => void;
  onQuery: (q: string) => void;
  onView: (v: ViewMode) => void;
  onNewFolder: () => void;
  onFiles: (files: File[]) => void;
  onOrganize: () => void;
  statusFilter: StatusFilter;
  onStatusFilter: (f: StatusFilter) => void;
  /** Top folder the explorer may show ("" = the organization; a client's folder). */
  root: string;
}

const NAV = "grid size-8 place-items-center rounded-md text-muted transition hover:bg-text/5 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent";

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Trail of the open folder: every level is clickable, client folders show the client's name. */
function Crumbs({ folder, orgName, clientNames, onOpen, root }: Pick<ExplorerToolbarProps, "folder" | "orgName" | "clientNames" | "onOpen" | "root">) {
  const levels = levelsFrom(folder, root);
  return (
    <nav aria-label="Local" className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-line bg-bg px-1.5 py-1 text-[13px]">
      {levels.map((path, i) => (
        <span key={path || "/"} className="flex shrink-0 items-center">
          {i > 0 && <span className="px-1 text-muted" aria-hidden>›</span>}
          <button
            type="button"
            onClick={() => onOpen(path)}
            aria-current={i === levels.length - 1 ? "location" : undefined}
            className={`rounded px-1.5 py-0.5 hover:bg-text/5 ${i === levels.length - 1 ? "font-semibold" : "text-muted hover:text-text"}`}
          >
            {folderLabel(path, clientNames, orgName)}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function ExplorerToolbar(p: ExplorerToolbarProps) {
  const files = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    if (list.length > 0) p.onFiles(list);
  };

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
      <div className="flex items-center gap-1">
        <button type="button" onClick={p.onBack} disabled={!p.canBack} aria-label="Voltar" title="Voltar (Alt+←)" className={NAV}><Icon d="M15 18l-6-6 6-6" /></button>
        <button type="button" onClick={p.onForward} disabled={!p.canForward} aria-label="Avançar" title="Avançar (Alt+→)" className={NAV}><Icon d="M9 18l6-6-6-6" /></button>
        <button type="button" onClick={p.onUp} disabled={p.folder === p.root} aria-label="Pasta acima" title="Pasta acima (Backspace)" className={NAV}><Icon d="M12 19V5M5 12l7-7 7 7" /></button>
        <Crumbs folder={p.folder} orgName={p.orgName} clientNames={p.clientNames} onOpen={p.onOpen} root={p.root} />
        <label className="relative hidden w-56 shrink-0 sm:block">
          <span className="sr-only">Buscar nesta pasta</span>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5" size={14} /></span>
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder={`Buscar em ${folderLabel(p.folder, p.clientNames, p.orgName)}`}
            className="w-full rounded-md border border-line bg-bg py-1 pl-8 pr-2 text-[13px] outline-none focus:border-brand"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => files.current?.click()} disabled={p.busy} className="btn btn-primary flex items-center gap-1.5 px-3 py-1.5 text-[13px]">
          <Icon d="M12 16V4M7 9l5-5 5 5M5 20h14" size={14} /> Enviar arquivos
        </button>
        <button type="button" onClick={() => folderInput.current?.click()} disabled={p.busy} className="btn btn-ghost px-3 py-1.5 text-[13px]">Enviar pasta</button>
        <button type="button" onClick={p.onNewFolder} disabled={p.busy} className="btn btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[13px]">
          <Icon d="M12 11v6M9 14h6M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} /> Nova pasta
        </button>
        <button
          type="button"
          onClick={p.onOrganize}
          disabled={p.busy}
          title="Leva os arquivos fiscais soltos (SPED, NF-e) para a pasta padrão: fiscal/<molde>/<CNPJ>/<período>"
          className="btn btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
        >
          <Icon d="M12 3l1.9 4.6L19 9.5l-4 3.4 1.2 5.1L12 15.3 7.8 18l1.2-5.1-4-3.4 5.1-1.9z" size={14} /> Organizar pasta
        </button>
        <input ref={files} type="file" multiple hidden onChange={pick} />
        <input ref={folderInput} type="file" hidden onChange={pick} {...{ webkitdirectory: "", directory: "" }} />
        <select
          value={p.statusFilter}
          onChange={(e) => p.onStatusFilter(e.target.value as StatusFilter)}
          aria-label="Mostrar"
          className="ml-auto rounded-md border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-brand"
        >
          {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <div role="group" aria-label="Exibição" className="flex rounded-md border border-line p-0.5">
          {(["details", "icons"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => p.onView(v)}
              aria-pressed={p.view === v}
              title={v === "details" ? "Detalhes" : "Ícones grandes"}
              className={`grid size-7 place-items-center rounded transition ${p.view === v ? "bg-brand/10 text-brand-2" : "text-muted hover:text-text"}`}
            >
              {v === "details" ? <Icon d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" size={14} /> : <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
