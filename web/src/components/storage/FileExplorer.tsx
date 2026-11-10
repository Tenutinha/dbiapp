"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { matchesQuery } from "@/lib/text-search";
import { canMoveTo, decorate, isProtectedFolder, parentOf, sortEntries, type SortDir, type SortKey } from "@/lib/storage-explorer";
import type { ExplorerItem } from "./api";
import { ContextMenu, type MenuAction } from "./ContextMenu";
import { droppedFiles, hasExternalFiles, INTERNAL_DRAG, type DroppedFile } from "./dropped";
import { DeleteDialog, MoveDialog } from "./ExplorerDialogs";
import { ExplorerToolbar, type StatusFilter, type ViewMode } from "./ExplorerToolbar";
import { OrganizeDialog } from "./OrganizeDialog";
import { ExplorerTree, folderLabel } from "./ExplorerTree";
import { prefetchFolder } from "./cache";
import { useUploadCenter } from "./UploadCenter";
import { useExplorer } from "./useExplorer";
import { DetailsView, IconsView } from "./views";

interface PickMode {
  /** What is being chosen for (shown in the footer), e.g. "itens_pis_cofins". */
  label: string;
  /** Files that can be chosen; the rest are dimmed. */
  accept: (item: ExplorerItem) => boolean;
  onPick: (item: ExplorerItem) => void;
  onCancel: () => void;
}

interface FileExplorerProps {
  org: string;
  orgName: string;
  initialFolder: string;
  /** Called when the open folder changes (e.g. to keep it in the address). */
  onFolderChange?: (folder: string) => void;
  /** Choosing a file for a dashboard table instead of only browsing. */
  pick?: PickMode;
}

const VIEW_KEY = "dbi:arquivos-visao";

/** Small spinning ring (loading). */
function Spinner() {
  return <span aria-hidden className="dbi-spin inline-block size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent" />;
}

function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "icons" ? "icons" : "details";
  } catch {
    return "details";
  }
}

/** Files picked with the folder input carry their path inside the chosen folder. */
function fromInput(files: File[]): DroppedFile[] {
  return files.map((file) => ({ file, dir: parentOf(file.webkitRelativePath || "") }));
}

/**
 * The organization's storage as a desktop file manager: folder tree, details or large icons, Windows-like
 * selection, drag to move, drop files or whole folders anywhere to upload (with a queue), rename, delete.
 */
export function FileExplorer({ org, orgName, initialFolder, onFolderChange, pick }: FileExplorerProps) {
  const ex = useExplorer(org, initialFolder, onFolderChange);
  const uploads = useUploadCenter();
  const { stored } = ex;
  // Files landing in this organization refresh the open listing (the queue itself lives above every page).
  useEffect(() => uploads.subscribe((o, folder, name) => o === org && stored(folder, name)), [uploads, org, stored]);
  const enqueue = useCallback((files: readonly DroppedFile[], target: string) => uploads.enqueue(org, files, target), [uploads, org]);
  const [view, setView] = useState<ViewMode>("details");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; item: ExplorerItem | null } | null>(null);
  const [dialog, setDialog] = useState<"delete" | "move" | "organize" | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Keyboard shortcuts keep working after a rename or a dialog (focus returns to the explorer, as in Windows). */
  const refocus = (): void => root.current?.focus({ preventScroll: true });

  useEffect(() => setView(readView()), []);
  useEffect(() => setQuery(""), [ex.folder]);

  const clientNames = useMemo(() => new Map((ex.meta?.clients ?? []).map((c) => [c.slug, c.name])), [ex.meta]);
  // The listing of another folder (still loading the new one) is never shown nor acted on.
  const current = ex.data && ex.data.folder === ex.folder ? ex.data : null;
  const insights = ex.insights;
  /** Pick mode: the file fits the table being chosen as it is. */
  const matches = useCallback(
    (i: ExplorerItem): boolean => !!pick && !i.folder && !!insights?.[i.path]?.verdict.readyFor?.some((r) => r.table === pick.label),
    [pick, insights],
  );
  const items = useMemo(() => {
    const all = current ? decorate(current.entries, current.folder, ex.meta) : [];
    const verdictOf = (i: ExplorerItem) => insights?.[i.path]?.verdict;
    const byStatus = statusFilter === "all" ? all : all.filter((i) => {
      if (i.folder) return true;
      const v = verdictOf(i);
      if (!v) return false;
      if (statusFilter === "outOfPlace") return v.inStandard === false;
      if (statusFilter === "unknown") return v.status === "unknown";
      return v.status === statusFilter;
    });
    const shown = query.trim()
      ? byStatus.filter((i) => matchesQuery(`${i.name} ${i.client ?? ""} ${verdictOf(i)?.layout ?? ""}`, query))
      : byStatus;
    const sorted = sortEntries(shown, sort.key, sort.dir);
    // Pick mode: files ready for the table come first (after the folders).
    return pick ? [...sorted.filter((i) => i.folder), ...sorted.filter((i) => !i.folder && matches(i)), ...sorted.filter((i) => !i.folder && !matches(i))] : sorted;
  }, [current, ex.meta, insights, statusFilter, query, sort, pick, matches]);
  const selectedItems = items.filter((i) => ex.selected.has(i.path));
  const pickable = pick && selectedItems.length === 1 && !selectedItems[0].folder && pick.accept(selectedItems[0]) ? selectedItems[0] : null;

  const chooseView = (v: ViewMode): void => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // not remembered: still applies now
    }
  };

  const open = useCallback((item: ExplorerItem) => {
    if (item.folder) ex.go(item.path);
    else if (pick?.accept(item)) pick.onPick(item);
  }, [ex, pick]);

  /** A drop on a folder (or on the open folder's empty area): move items or upload files. */
  const drop = useCallback((e: React.DragEvent, target: string) => {
    e.preventDefault();
    setDropTarget(null);
    setFilesOver(false);
    const internal = e.dataTransfer.getData(INTERNAL_DRAG);
    if (internal) {
      const paths = (JSON.parse(internal) as string[]).filter((p) => canMoveTo({ path: p, folder: items.find((i) => i.path === p)?.folder ?? false }, target) === null);
      if (paths.length > 0) void ex.actions.move(paths, target);
      return;
    }
    if (hasExternalFiles(e.dataTransfer)) void droppedFiles(e.dataTransfer).then((files) => enqueue(files, target));
  }, [ex.actions, items, enqueue]);

  const startDrag = (item: ExplorerItem, e: React.DragEvent): void => {
    const paths = ex.selected.has(item.path) ? [...ex.selected] : [item.path];
    if (!ex.selected.has(item.path)) ex.setSelected(new Set([item.path]));
    e.dataTransfer.setData(INTERNAL_DRAG, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "move";
  };

  const menuFor = (item: ExplorerItem | null): (MenuAction | "-")[] => {
    if (!item) {
      return [
        { label: "Nova pasta", onClick: ex.actions.newFolder },
        { label: "Atualizar", shortcut: "F5", onClick: ex.reload },
      ];
    }
    const locked = item.folder && isProtectedFolder(item.path);
    const many = ex.selected.size > 1;
    return [
      { label: item.folder ? "Abrir" : pick?.accept(item) ? "Escolher este arquivo" : "Abrir", disabled: !item.folder && !pick?.accept(item), onClick: () => open(item) },
      "-",
      { label: "Renomear", shortcut: "F2", disabled: locked || many, onClick: () => ex.setRenaming(item.path) },
      { label: "Mover para…", disabled: locked, onClick: () => setDialog("move") },
      { label: "Copiar caminho", onClick: () => void navigator.clipboard?.writeText(item.path) },
      "-",
      { label: many ? `Excluir ${ex.selected.size} itens` : "Excluir", shortcut: "Del", danger: true, disabled: locked, onClick: () => setDialog("delete") },
    ];
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (ex.renaming || dialog || (e.target as HTMLElement).tagName === "INPUT") return;
    const one = selectedItems.length === 1 ? selectedItems[0] : null;
    if (e.key === "Delete" && selectedItems.length > 0 && !selectedItems.some((i) => i.folder && isProtectedFolder(i.path))) setDialog("delete");
    else if (e.key === "F2" && one && !(one.folder && isProtectedFolder(one.path))) ex.setRenaming(one.path);
    else if (e.key === "Enter" && one) open(one);
    else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) ex.goUp();
    else if (e.altKey && e.key === "ArrowLeft") ex.goBack();
    else if (e.altKey && e.key === "ArrowRight") ex.goForward();
    else if (e.key === "F5") ex.reload();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") ex.setSelected(new Set(items.map((i) => i.path)));
    else if (e.key === "Escape") ex.setSelected(new Set());
    else return;
    e.preventDefault();
  };

  const viewProps = {
    items, selected: ex.selected, fresh: ex.fresh, renaming: ex.renaming, clientNames, orgName,
    disabled: pick ? (i: ExplorerItem) => !i.folder && !pick.accept(i) : undefined,
    dropTarget,
    onSelect: (item: ExplorerItem, e: React.MouseEvent) => ex.select(item, e, items),
    onOpen: open,
    onContextMenu: (item: ExplorerItem, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!ex.selected.has(item.path)) ex.setSelected(new Set([item.path]));
      setMenu({ x: e.clientX, y: e.clientY, item });
    },
    onRename: (item: ExplorerItem, name: string | null) => {
      ex.actions.rename(item, name);
      refocus();
    },
    onDragStartItem: startDrag,
    onDragOverFolder: setDropTarget,
    onDropOnFolder: drop,
    onHoverFolder: (path: string) => prefetchFolder(org, path),
    insights,
    analyzing: ex.analyzing,
    matches: pick ? matches : undefined,
  };

  const totalSize = (pick ? selectedItems : selectedItems.length ? selectedItems : items).reduce((s, i) => s + i.sizeBytes, 0);

  return (
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!hasExternalFiles(e.dataTransfer)) return;
        e.preventDefault();
        setFilesOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFilesOver(false);
      }}
      onDrop={(e) => drop(e, ex.folder)}
      className="relative flex h-full min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-card text-text outline-none"
    >
      <ExplorerToolbar
        folder={ex.folder} orgName={orgName} clientNames={clientNames}
        canBack={ex.canBack} canForward={ex.canForward} query={query} view={view} busy={ex.busy}
        onBack={ex.goBack} onForward={ex.goForward} onUp={ex.goUp} onOpen={ex.go} onQuery={setQuery} onView={chooseView}
        onNewFolder={ex.actions.newFolder} onFiles={(files) => enqueue(fromInput(files), ex.folder)}
        onOrganize={() => setDialog("organize")} statusFilter={statusFilter} onStatusFilter={setStatusFilter}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] max-md:grid-cols-1">
        <aside className="min-h-0 overflow-hidden border-r border-line bg-bg/40 max-md:hidden">
          <ExplorerTree org={org} orgName={orgName} clientNames={clientNames} current={ex.folder} version={ex.version} onOpen={ex.go} onDrop={drop} />
        </aside>
        <div
          className="relative min-h-0 overflow-auto"
          onClick={(e) => e.target === e.currentTarget && ex.setSelected(new Set())}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, item: null });
          }}
        >
          {ex.error ? (
            <p className="p-6 text-sm text-danger">{ex.error}</p>
          ) : !current ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted"><Spinner /> Abrindo a pasta…</p>
          ) : items.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-muted">
              <div>
                <p className="text-base font-semibold text-text">{query ? "Nada encontrado" : "Pasta vazia"}</p>
                <p className="mt-1">{query ? `Nenhum item com “${query}” nesta pasta.` : "Arraste arquivos ou pastas do computador para cá, ou use “Enviar arquivos”."}</p>
              </div>
            </div>
          ) : view === "details" ? (
            <DetailsView {...viewProps} sort={sort.key} dir={sort.dir} onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))} />
          ) : (
            <IconsView {...viewProps} />
          )}
          {ex.loading && current && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-brand" />}
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-xs text-muted">
        <span>{items.length} {items.length === 1 ? "item" : "itens"}</span>
        {(ex.loading || ex.busy) && <span className="flex items-center gap-1.5 text-brand-2" role="status"><Spinner /> {ex.busy ? "Salvando…" : "Atualizando…"}</span>}
        {selectedItems.length > 0 && <span>{selectedItems.length} selecionado(s){totalSize ? ` · ${formatBytes(totalSize)}` : ""}</span>}
        {current?.truncated && <span className="text-accent">Mostrando os primeiros 2.000 arquivos desta pasta.</span>}
        {ex.notice && <span role="status" className={`ml-auto truncate ${ex.notice.tone === "ok" ? "text-ok" : "text-danger"}`}>{ex.notice.text}</span>}
        {pick && (
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden truncate sm:inline">{pickable ? pickable.name : `Escolha o arquivo de ${pick.label}`}</span>
            <button type="button" onClick={pick.onCancel} className="btn btn-ghost px-3 py-1 text-[13px]">Cancelar</button>
            <button type="button" disabled={!pickable} onClick={() => pickable && pick.onPick(pickable)} className="btn btn-primary px-3 py-1 text-[13px] disabled:opacity-50">Conectar</button>
          </span>
        )}
      </footer>

      {filesOver && (
        <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/10 backdrop-blur-[1px]">
          <p className="rounded-lg bg-card px-4 py-2 text-sm font-semibold shadow">
            Solte para enviar para <span className="text-brand-2">{folderLabel(dropTarget ?? ex.folder, clientNames, orgName)}</span>
          </p>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuFor(menu.item)} onClose={() => setMenu(null)} />}
      {dialog === "delete" && (
        <DeleteDialog
          items={selectedItems} busy={ex.busy} clientNames={clientNames} orgName={orgName}
          onCancel={() => {
            setDialog(null);
            refocus();
          }}
          onConfirm={() => void ex.actions.remove(selectedItems.map((i) => i.path)).then(() => {
            setDialog(null);
            refocus();
          })}
        />
      )}
      {dialog === "organize" && (
        <OrganizeDialog
          org={org}
          folder={ex.folder}
          folderName={folderLabel(ex.folder, clientNames, orgName)}
          onCancel={() => {
            setDialog(null);
            refocus();
          }}
          onDone={(res) => {
            setDialog(null);
            ex.changed([...res.done.map((d) => d.to), ...res.done.map((d) => parentOf(d.path))]);
            ex.setNotice(
              res.failed.length === 0
                ? { tone: "ok", text: `${res.done.length} arquivo(s) organizado(s) na pasta padrão.` }
                : { tone: "error", text: `${res.done.length} organizado(s); ${res.failed.length} não: ${res.failed[0].error}` },
            );
            refocus();
          }}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          org={org} orgName={orgName} clientNames={clientNames} count={selectedItems.length} start={ex.folder} busy={ex.busy}
          onCancel={() => {
            setDialog(null);
            refocus();
          }}
          onConfirm={(target) => void ex.actions.move(selectedItems.map((i) => i.path), target).then(() => {
            setDialog(null);
            refocus();
          })}
        />
      )}
    </div>
  );
}
