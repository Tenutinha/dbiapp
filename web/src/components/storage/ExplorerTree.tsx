"use client";

import { useCallback, useEffect, useState } from "react";
import { clientSlugOf, CLIENTS_DIR, joinPath } from "@/lib/storage-explorer";
import { loadFolder, peekFolder, prefetchFolder } from "./cache";
import { FileIcon } from "./FileIcon";

interface ExplorerTreeProps {
  org: string;
  orgName: string;
  /** Client slug → name, to show client folders by name. */
  clientNames: ReadonlyMap<string, string>;
  current: string;
  /** Bumped after changes, to reload the expanded levels. */
  version: number;
  onOpen: (path: string) => void;
  /** Something was dropped on a folder (items being moved or files from the computer). */
  onDrop: (e: React.DragEvent, target: string) => void;
}

/** Label of a folder: a client's folder shows the client's name. */
export function folderLabel(path: string, clientNames: ReadonlyMap<string, string>, orgName: string): string {
  if (path === "") return orgName;
  const parts = path.split("/");
  if (parts.length === 1 && parts[0] === CLIENTS_DIR) return "Clientes";
  const slug = clientSlugOf(path);
  if (parts.length === 2 && slug) return clientNames.get(slug) ?? slug;
  return parts[parts.length - 1];
}

const foldersIn = (data: { entries: { name: string; folder: boolean }[] }): string[] => data.entries.filter((i) => i.folder).map((i) => i.name);

const ancestors = (path: string): string[] => {
  const parts = path.split("/").filter(Boolean);
  return ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
};

/** Folder tree on the left of the explorer, loaded level by level as folders are expanded. */
export function ExplorerTree({ org, orgName, clientNames, current, version, onOpen, onDrop }: ExplorerTreeProps) {
  // Levels already listed somewhere on the page show at once.
  const [children, setChildren] = useState<Map<string, string[]>>(() => {
    const known = new Map<string, string[]>();
    for (const path of ancestors(current)) {
      const cached = peekFolder(org, path);
      if (cached) known.set(path, foldersIn(cached));
    }
    return known;
  });
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestors(current)));
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    try {
      const data = await loadFolder(org, path);
      setChildren((m) => new Map(m).set(path, foldersIn(data)));
    } catch {
      setChildren((m) => new Map(m).set(path, []));
    }
  }, [org]);

  // The way to the open folder is always expanded.
  useEffect(() => {
    setOpen((s) => new Set([...s, ...ancestors(current)]));
  }, [current]);

  // (Re)load every expanded level after a change.
  useEffect(() => {
    for (const path of open) void load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on version bumps, not on each toggle
  }, [version, load]);

  const toggle = (path: string): void => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children.has(path)) void load(path);
      }
      return next;
    });
  };

  const node = (path: string, depth: number): React.ReactNode => {
    const kids = children.get(path);
    const expanded = open.has(path);
    const isClient = path.split("/").length === 2 && clientSlugOf(path) !== null;
    return (
      <li key={path || "/"}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation(); // the explorer behind must not take the same drop too
            setOver(path);
          }}
          onDragLeave={() => setOver((o) => (o === path ? null : o))}
          onDrop={(e) => {
            e.stopPropagation();
            setOver(null);
            onDrop(e, path);
          }}
          className={`flex items-center gap-1 rounded-md pr-2 text-[13px] ${current === path ? "bg-brand/15 font-semibold" : "hover:bg-text/5"} ${over === path ? "ring-2 ring-brand" : ""}`}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button
            type="button"
            onClick={() => toggle(path)}
            aria-label={expanded ? "Recolher" : "Expandir"}
            className={`grid size-5 shrink-0 place-items-center text-[10px] text-muted ${kids && kids.length === 0 ? "invisible" : ""}`}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <button type="button" onClick={() => onOpen(path)} onMouseEnter={() => prefetchFolder(org, path)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left">
            <FileIcon name="" folder size={18} open={expanded} client={isClient} />
            <span className="truncate">{folderLabel(path, clientNames, orgName)}</span>
          </button>
        </div>
        {expanded && kids && kids.length > 0 && (
          <ul>{kids.map((k) => node(joinPath(path, k), depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Pastas" className="min-h-0 overflow-auto py-2 pl-1 pr-2">
      <ul>{node("", 0)}</ul>
    </nav>
  );
}
