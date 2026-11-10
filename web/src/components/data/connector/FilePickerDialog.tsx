"use client";

import { useEffect, useRef } from "react";
import type { ExplorerItem } from "@/components/storage/api";
import { FileExplorer } from "@/components/storage/FileExplorer";
import { fileKind, parentOf } from "@/lib/storage-explorer";

interface FilePickerDialogProps {
  org: { slug: string; name: string };
  /** Table the file is for (shown in the title). */
  table: string;
  /** Folder opened first: the space's own folder. */
  folder: string;
  onPick: (choice: { folder: string; file: string }) => void;
  onClose: () => void;
}

/**
 * "Escolher arquivo" of a contract table: the organization's file explorer in pick mode, over the data
 * modal. Only data files (.parquet, .csv, .txt) can be chosen; uploading and organizing still work here.
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
      aria-label={`Escolher arquivo para ${table}`}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      style={{ width: "min(1200px, calc(100vw - 2rem))" }}
      className="m-auto rounded-2xl border border-line bg-bg p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-2">Escolher arquivo</p>
          <h2 className="truncate text-lg font-bold">
            Para a tabela <code className="font-mono">{table}</code>
          </h2>
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Fechar" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-text/5 hover:text-text">×</button>
      </header>
      <div className="h-[min(720px,calc(100vh-8rem))] px-5 pb-5">
        <FileExplorer
          org={org.slug}
          orgName={org.name}
          initialFolder={folder}
          pick={{
            label: table,
            accept: (item: ExplorerItem) => !item.folder && fileKind(item.name).data,
            onPick: (item: ExplorerItem) => {
              onPick({ folder: parentOf(item.path), file: item.name });
              ref.current?.close();
            },
            onCancel: () => ref.current?.close(),
          }}
        />
      </div>
    </dialog>
  );
}
