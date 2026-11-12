"use client";

import { useEffect, useRef } from "react";
import type { ExplorerItem } from "@/components/storage/api";
import { FileExplorer } from "@/components/storage/FileExplorer";
import { clientScopeOf, fileKind, parentOf } from "@/lib/storage-explorer";
import type { FilePick } from "./types";

interface FilePickerDialogProps {
  org: { slug: string; name: string };
  /** Table the files are for (shown in the title). */
  table: string;
  /** Folder opened first: the space's own folder. */
  folder: string;
  /** One or more files (Ctrl or Shift in the explorer): all of them feed the table. */
  onPick: (choices: FilePick[]) => void;
  onClose: () => void;
}

/**
 * "Escolher arquivos" of a contract table: the organization's file explorer in pick mode, over the data
 * modal. Only data files (.parquet, .csv, .txt) can be chosen, one or several at once; uploading and
 * organizing still work here.
 */
export function FilePickerDialog({ org, table, folder, onPick, onClose }: FilePickerDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={`Escolher arquivos para ${table}`}
      onClose={(e) => {
        // Only this dialog's own closing counts, not one opened inside the explorer.
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      style={{ width: "min(1200px, calc(100vw - 2rem))" }}
      className="m-auto rounded-2xl border border-line bg-bg p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-2">Escolher arquivos</p>
          <h2 className="truncate text-lg font-bold">
            Para a tabela <code className="font-mono">{table}</code>
          </h2>
          <p className="text-xs text-muted">Para escolher vários de uma vez, segure Ctrl ou Shift ao clicar. Todos alimentam a mesma tabela.</p>
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Fechar" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-text/5 hover:text-text">×</button>
      </header>
      <div className="h-[min(720px,calc(100vh-8rem))] px-5 pb-5">
        <FileExplorer
          org={org.slug}
          orgName={org.name}
          initialFolder={folder}
          root={clientScopeOf(folder)}
          pick={{
            label: table,
            multiple: true,
            accept: (item: ExplorerItem) => !item.folder && fileKind(item.name).data,
            onPick: (items: ExplorerItem[]) => {
              onPick(items.map((item) => ({ folder: parentOf(item.path), file: item.name })));
              ref.current?.close();
            },
            onCancel: () => ref.current?.close(),
          }}
        />
      </div>
    </dialog>
  );
}
