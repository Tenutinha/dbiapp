"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { ExplorerItem } from "./api";
import { ExplorerTree, folderLabel } from "./ExplorerTree";

function Overlay({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="absolute inset-0 z-40 grid place-items-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-2xl">
        <h3 className="font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

interface DeleteDialogProps {
  items: ExplorerItem[];
  busy: boolean;
  clientNames: ReadonlyMap<string, string>;
  orgName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation listing what will go, with a warning for files dashboards have used. */
export function DeleteDialog({ items, busy, clientNames, orgName, onConfirm, onCancel }: DeleteDialogProps) {
  const used = items.filter((i) => i.usedIn.length > 0);
  const folders = items.filter((i) => i.folder).length;
  return (
    <Overlay title={items.length === 1 ? "Excluir este item?" : `Excluir ${items.length} itens?`} onCancel={onCancel}>
      <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-line text-[13px]">
        {items.map((i) => (
          <li key={i.path} className="flex justify-between gap-3 border-b border-line px-3 py-1.5 last:border-0">
            <span className="truncate">{i.folder ? `📁 ${folderLabel(i.path, clientNames, orgName)}` : i.name}</span>
            {!i.folder && <span className="shrink-0 text-muted">{formatBytes(i.sizeBytes)}</span>}
          </li>
        ))}
      </ul>
      {folders > 0 && <p className="mt-3 text-xs text-muted">Pastas são excluídas com tudo o que há dentro delas.</p>}
      {used.length > 0 && (
        <p className="mt-3 rounded-lg bg-accent/10 p-2.5 text-xs text-accent">
          {used.length === 1 ? "Um arquivo" : `${used.length} arquivos`} já alimentaram dashboards ({[...new Set(used.flatMap((u) => u.usedIn.map((x) => x.dashboard)))].join(", ")}).
          Os dados já engatados continuam no dashboard; só o arquivo original some do armazenamento.
        </p>
      )}
      <p className="mt-3 text-xs font-semibold text-danger">Não dá para desfazer.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost" autoFocus>Cancelar</button>
        <button type="button" onClick={onConfirm} disabled={busy} className="btn bg-danger text-white disabled:opacity-60">
          {busy ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    </Overlay>
  );
}

interface MoveDialogProps {
  org: string;
  orgName: string;
  clientNames: ReadonlyMap<string, string>;
  count: number;
  start: string;
  busy: boolean;
  onConfirm: (target: string) => void;
  onCancel: () => void;
}

/** "Mover para…": pick the destination folder in a tree. */
export function MoveDialog({ org, orgName, clientNames, count, start, busy, onConfirm, onCancel }: MoveDialogProps) {
  const [target, setTarget] = useState(start);
  return (
    <Overlay title={`Mover ${count === 1 ? "1 item" : `${count} itens`} para…`} onCancel={onCancel}>
      <div className="mt-3 h-64 overflow-hidden rounded-lg border border-line">
        <ExplorerTree org={org} orgName={orgName} clientNames={clientNames} current={target} version={0} onOpen={setTarget} onDrop={(e) => e.preventDefault()} />
      </div>
      <p className="mt-2 truncate text-xs text-muted">Destino: <b className="text-text">{folderLabel(target, clientNames, orgName)}</b> ({target || "/"})</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost" autoFocus>Cancelar</button>
        <button type="button" onClick={() => onConfirm(target)} disabled={busy} className="btn btn-primary disabled:opacity-60">
          {busy ? "Movendo…" : "Mover aqui"}
        </button>
      </div>
    </Overlay>
  );
}
