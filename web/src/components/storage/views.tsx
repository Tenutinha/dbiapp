"use client";

import { useEffect, useRef } from "react";
import { formatBytes } from "@/lib/format";
import { clientSlugOf, fileKind, type SortDir, type SortKey } from "@/lib/storage-explorer";
import type { ExplorerItem, FileInsight } from "./api";
import { STATUS_STYLE, StatusBadge } from "./StatusBadge";
import { INTERNAL_DRAG } from "./dropped";
import { FileIcon } from "./FileIcon";
import { folderLabel } from "./ExplorerTree";

/** What both views (details and large icons) need from the explorer. */
export interface ViewProps {
  items: ExplorerItem[];
  selected: ReadonlySet<string>;
  /** Freshly uploaded or created items, highlighted for a moment. */
  fresh: ReadonlySet<string>;
  renaming: string | null;
  clientNames: ReadonlyMap<string, string>;
  orgName: string;
  /** Pick mode: items that cannot be chosen are dimmed. */
  disabled?: (item: ExplorerItem) => boolean;
  dropTarget: string | null;
  onSelect: (item: ExplorerItem, e: React.MouseEvent) => void;
  onOpen: (item: ExplorerItem) => void;
  onContextMenu: (item: ExplorerItem, e: React.MouseEvent) => void;
  onRename: (item: ExplorerItem, name: string | null) => void;
  onDragStartItem: (item: ExplorerItem, e: React.DragEvent) => void;
  onDragOverFolder: (path: string | null) => void;
  onDropOnFolder: (e: React.DragEvent, path: string) => void;
  /** The pointer rests on a folder: load it ahead of the click. */
  onHoverFolder?: (path: string) => void;
  /** What each file is (layout and verdict), by path; null while the first analysis runs. */
  insights: Readonly<Record<string, FileInsight>> | null;
  analyzing: boolean;
  /** Pick mode: files ready for the table being chosen (highlighted). */
  matches?: (item: ExplorerItem) => boolean;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function label(item: ExplorerItem, props: Pick<ViewProps, "clientNames" | "orgName">): string {
  return item.folder ? folderLabel(item.path, props.clientNames, props.orgName) : item.name;
}

const isClientFolder = (item: ExplorerItem): boolean => item.folder && item.path.split("/").length === 2 && clientSlugOf(item.path) !== null;

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // Enter/Esc already answered: the blur that follows must not answer again.
  const answered = useRef(false);
  const finish = (name: string | null): void => {
    if (answered.current) return;
    answered.current = true;
    onDone(name);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length); // like Windows: the name, not the extension
  }, [initial]);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Novo nome"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="w-full min-w-0 rounded border border-brand bg-bg px-1 py-0.5 text-[13px] outline-none"
    />
  );
}

/** Mouse/drag wiring shared by a row (details) and a tile (icons). */
function itemHandlers(item: ExplorerItem, p: ViewProps) {
  const off = p.disabled?.(item) ?? false;
  return {
    draggable: p.renaming !== item.path,
    "data-path": item.path,
    "aria-selected": p.selected.has(item.path),
    "aria-disabled": off || undefined,
    onClick: (e: React.MouseEvent) => p.onSelect(item, e),
    onDoubleClick: () => !off && p.onOpen(item),
    onContextMenu: (e: React.MouseEvent) => p.onContextMenu(item, e),
    onMouseEnter: item.folder ? () => p.onHoverFolder?.(item.path) : undefined,
    onDragStart: (e: React.DragEvent) => p.onDragStartItem(item, e),
    onDragOver: item.folder
      ? (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes(INTERNAL_DRAG) ? "move" : "copy";
          p.onDragOverFolder(item.path);
        }
      : undefined,
    onDragLeave: item.folder ? () => p.onDragOverFolder(null) : undefined,
    onDrop: item.folder
      ? (e: React.DragEvent) => {
          e.stopPropagation();
          p.onDropOnFolder(e, item.path);
        }
      : undefined,
  };
}

function rowTone(item: ExplorerItem, p: ViewProps): string {
  if (p.dropTarget === item.path) return "bg-brand/20 ring-2 ring-inset ring-brand";
  if (p.selected.has(item.path)) return "bg-brand/15";
  if (p.fresh.has(item.path)) return "bg-ok/10";
  // Pick mode: files that fit the table being chosen stand out.
  if (p.matches?.(item)) return "bg-ok/5 shadow-[inset_3px_0_0_var(--color-ok)] hover:bg-ok/10";
  return "hover:bg-text/5";
}

const COLUMNS: { key: SortKey | null; label: string; className: string }[] = [
  { key: "name", label: "Nome", className: "w-[25%]" },
  { key: null, label: "Cliente", className: "w-[10%] max-lg:hidden" },
  { key: "type", label: "Layout", className: "w-[19%] max-md:hidden" },
  { key: null, label: "Situação", className: "w-[20%] max-md:hidden" },
  { key: "size", label: "Tamanho", className: "w-[8%] text-right" },
  { key: "updated", label: "Modificado", className: "w-[10%] max-lg:hidden" },
  { key: null, label: "Usado em", className: "w-[8%] max-lg:hidden" },
];

export function DetailsView(p: ViewProps & { sort: SortKey; dir: SortDir; onSort: (key: SortKey) => void }) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
      <thead className="sticky top-0 z-10 bg-card">
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.label} scope="col" className={`border-b border-line px-2 py-1.5 text-left font-medium text-muted ${c.className}`}>
              {c.key ? (
                <button type="button" onClick={() => p.onSort(c.key!)} className="flex w-full items-center gap-1 hover:text-text">
                  <span className={c.className.includes("text-right") ? "ml-auto" : ""}>{c.label}</span>
                  {p.sort === c.key && <span aria-hidden>{p.dir === "asc" ? "▲" : "▼"}</span>}
                </button>
              ) : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {p.items.map((item) => {
          const off = p.disabled?.(item) ?? false;
          return (
            <tr key={item.path} {...itemHandlers(item, p)} className={`cursor-default select-none ${rowTone(item, p)} ${off ? "opacity-45" : ""}`}>
              <td className="px-2 py-1">
                <span className="flex min-w-0 items-center gap-2">
                  <FileIcon name={item.name} folder={item.folder} client={isClientFolder(item)} size={20} />
                  {p.renaming === item.path ? (
                    <RenameInput initial={item.name} onDone={(n) => p.onRename(item, n)} />
                  ) : (
                    <span className="truncate" title={item.path}>{label(item, p)}</span>
                  )}
                </span>
              </td>
              <td className="truncate px-2 py-1 text-muted max-lg:hidden">{item.client ?? "Organização"}</td>
              <td className="truncate px-2 py-1 text-muted max-md:hidden" title={p.insights?.[item.path]?.verdict.layout}>
                {item.folder ? "Pasta" : p.insights?.[item.path]?.verdict.layout ?? fileKind(item.name).label}
              </td>
              <td className="px-2 py-1 max-md:hidden">
                {!item.folder && <StatusBadge verdict={p.insights?.[item.path]?.verdict} analyzing={p.analyzing} />}
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted">{item.folder ? "" : formatBytes(item.sizeBytes)}</td>
              <td className="truncate whitespace-nowrap px-2 py-1 tabular-nums text-muted max-lg:hidden">{item.updatedAt ? dateFmt.format(new Date(item.updatedAt)) : ""}</td>
              <td className="px-2 py-1 max-lg:hidden">
                <span className="flex min-w-0 flex-wrap gap-1">
                  {item.usedIn.map((u) => (
                    <span key={`${u.dashboard}-${u.state}`} title={u.state === "active" ? "Publicado" : "Rascunho"} className={`truncate rounded px-1.5 text-[11px] ${u.state === "active" ? "bg-ok/15 text-ok" : "bg-accent/15 text-accent"}`}>
                      {u.dashboard}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function IconsView(p: ViewProps) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 p-2">
      {p.items.map((item) => {
        const off = p.disabled?.(item) ?? false;
        return (
          <li key={item.path} {...itemHandlers(item, p)} className={`flex cursor-default select-none flex-col items-center gap-1 rounded-lg p-2 text-center ${rowTone(item, p)} ${off ? "opacity-45" : ""}`} title={item.folder ? item.path : `${item.name} · ${formatBytes(item.sizeBytes)}`}>
            <FileIcon name={item.name} folder={item.folder} client={isClientFolder(item)} size={52} />
            {p.renaming === item.path ? (
              <RenameInput initial={item.name} onDone={(n) => p.onRename(item, n)} />
            ) : (
              <span className="line-clamp-2 w-full break-all text-[12px] leading-tight">{label(item, p)}</span>
            )}
            {!item.folder && p.insights?.[item.path] && (
              <span className={`size-2 rounded-full ${STATUS_STYLE[p.insights[item.path].verdict.status].dot}`} title={`${STATUS_STYLE[p.insights[item.path].verdict.status].label} · ${p.insights[item.path].verdict.detail}`} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
