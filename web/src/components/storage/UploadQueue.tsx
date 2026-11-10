"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/format";
import { FileIcon } from "./FileIcon";
import type { QueueItem } from "./useUploadQueue";

interface UploadQueueProps {
  items: QueueItem[];
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onClear: () => void;
  /** Opens the folder a file went to (in its organization's explorer). */
  onOpenFolder: (org: string, folder: string) => void;
}

function summary(items: QueueItem[]): string {
  const active = items.filter((i) => i.status === "waiting" || i.status === "sending").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const done = items.filter((i) => i.status === "done").length;
  if (active > 0) return `Enviando ${active} ${active === 1 ? "arquivo" : "arquivos"}…`;
  if (failed > 0) return `${failed} com falha · ${done} enviados`;
  return `${done} ${done === 1 ? "arquivo enviado" : "arquivos enviados"}`;
}

/** Floating panel in the corner of the screen, like a browser's downloads: one row per file. */
export function UploadQueue({ items, onCancel, onRetry, onClear, onOpenFolder }: UploadQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.file.size, 0);
  const sent = items.reduce((s, i) => s + (i.status === "done" ? i.file.size : i.loaded), 0);
  const busy = items.some((i) => i.status === "waiting" || i.status === "sending");

  return (
    <section aria-label="Envios" className="w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-card shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)]">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" aria-live="polite">{summary(items)}</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-text/10">
            <div className={`h-full rounded-full transition-[width] ${busy ? "bg-brand" : "bg-ok"}`} style={{ width: `${total ? (sent / total) * 100 : 0}%` }} />
          </div>
        </div>
        {!busy && <button type="button" onClick={onClear} className="text-xs text-muted hover:text-text">Limpar</button>}
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Mostrar envios" : "Recolher envios"} className="rounded px-1.5 text-muted hover:bg-text/5 hover:text-text">
          {collapsed ? "▴" : "▾"}
        </button>
      </header>
      {!collapsed && (
        <ul className="max-h-64 overflow-y-auto py-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <FileIcon name={i.file.name} folder={false} size={22} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]" title={i.file.name}>{i.note && i.status === "done" ? i.note : i.file.name}</p>
                {i.status === "sending" ? (
                  <>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-text/10">
                      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(i.loaded / Math.max(1, i.file.size)) * 100}%` }} />
                    </div>
                    <p className="text-[11px] text-muted">
                      {formatBytes(i.loaded)} de {formatBytes(i.file.size)}{i.speed > 0 ? ` · ${formatBytes(i.speed)}/s` : ""}
                    </p>
                  </>
                ) : (
                  <p className={`truncate text-[11px] ${i.status === "failed" ? "text-danger" : "text-muted"}`} title={i.note}>
                    {i.status === "waiting" && `Na fila · ${formatBytes(i.file.size)}`}
                    {i.status === "done" && (
                      <button type="button" onClick={() => onOpenFolder(i.org, i.folder)} className="hover:underline">
                        ✓ Em {i.folder || "Início"}
                      </button>
                    )}
                    {(i.status === "failed" || i.status === "cancelled") && i.note}
                  </p>
                )}
              </div>
              {(i.status === "waiting" || i.status === "sending") && (
                <button type="button" onClick={() => onCancel(i.id)} aria-label={`Cancelar ${i.file.name}`} title="Cancelar" className="rounded px-1.5 text-muted hover:bg-text/5 hover:text-danger">×</button>
              )}
              {(i.status === "failed" || i.status === "cancelled") && (
                <button type="button" onClick={() => onRetry(i.id)} className="shrink-0 text-xs font-semibold text-brand-2 hover:underline">Tentar de novo</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
