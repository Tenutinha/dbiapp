"use client";

import { useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { storeFile, type StoreResult } from "./store-client";

/** One file of the upload queue. */
interface QueueItem {
  id: number;
  file: File;
  status: "waiting" | "sending" | "done" | "failed";
  progress: number;
  /** Name it got in the folder, or the error. */
  note?: string;
}

/** Files sent at the same time. */
const PARALLEL = 3;
const ACCEPT = ".parquet,.csv,.txt,.xml,.json,.zip,.xlsx,.xls,.pdf,.pbix";

interface UploadStepProps {
  instanceId: string;
  /** Destination folder (the one open in the storage step), relative to the organization's folder. */
  folder: string;
  /** Called after each file is stored, with the name it got (to list the folder again and highlight it). */
  onStored: (name: string) => void;
}

/**
 * First step of the data connector: drop (or pick) files from the computer and they are kept in the
 * storage folder open next to it. Each file shows its own progress; failures can be retried.
 */
export function UploadStep({ instanceId, folder, onStored }: UploadStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [over, setOver] = useState(false);
  const running = useRef(0);
  const pending = useRef<QueueItem[]>([]);

  const update = (id: number, patch: Partial<QueueItem>): void =>
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  /** Takes the next waiting file while there is a free slot. */
  const pump = (target: string): void => {
    while (running.current < PARALLEL && pending.current.length > 0) {
      const item = pending.current.shift()!;
      running.current += 1;
      update(item.id, { status: "sending", progress: 0, note: undefined });
      void storeFile(instanceId, target, item.file, (p) => update(item.id, { progress: p }))
        .catch((): StoreResult => ({ error: "Falha de rede." }))
        .then((res: StoreResult) => {
          running.current -= 1;
          if (res.name) {
            update(item.id, { status: "done", progress: 1, note: res.name });
            onStored(res.name);
          } else {
            update(item.id, { status: "failed", note: res.error ?? "Falha no envio." });
          }
          pump(target);
        });
    }
  };

  const add = (files: File[]): void => {
    if (files.length === 0) return;
    const items = files.map((file): QueueItem => ({ id: nextId.current++, file, status: "waiting", progress: 0 }));
    setQueue((q) => [...items, ...q.filter((it) => it.status !== "done")].slice(0, 200));
    pending.current.push(...items);
    pump(folder);
  };

  const retry = (item: QueueItem): void => {
    update(item.id, { status: "waiting", progress: 0, note: undefined });
    pending.current.push(item);
    pump(folder);
  };

  const sending = queue.filter((it) => it.status === "sending" || it.status === "waiting").length;
  const done = queue.filter((it) => it.status === "done").length;
  const destination = folder ? folder : "raiz da organização";

  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">1 · Upload</p>
      <p className="mb-3 text-[11px] text-muted">
        Destino: <span className="font-mono text-text">{destination}</span>
      </p>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
        className={`flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-3 py-6 text-center transition ${
          over ? "border-brand bg-brand/10" : "border-line hover:border-brand/60"
        }`}
      >
        <span className="text-2xl" aria-hidden>⤒</span>
        <span className="text-xs font-medium">Arraste os arquivos aqui</span>
        <span className="text-[10px] text-muted">ou clique para escolher · parquet, csv, txt, xml, zip, xlsx, pdf…</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          add(files);
        }}
      />

      {queue.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[11px] text-muted">
            {sending > 0 ? `Enviando ${sending} arquivo(s)…` : `${done} arquivo(s) guardado(s).`}
          </p>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
            {queue.map((it) => (
              <li key={it.id} className="rounded-lg border border-line px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-xs">
                    {it.status === "done" ? "✓" : it.status === "failed" ? "✕" : it.status === "sending" ? "↑" : "…"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={it.file.name}>{it.file.name}</span>
                  <span className="text-[10px] text-muted">{formatBytes(it.file.size)}</span>
                </div>
                {it.status === "sending" && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </div>
                )}
                {it.status === "done" && it.note && it.note !== it.file.name && (
                  <p className="mt-0.5 text-[10px] text-muted">guardado como <span className="font-mono">{it.note}</span></p>
                )}
                {it.status === "failed" && (
                  <p className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-danger">
                    <span>{it.note}</span>
                    <button type="button" onClick={() => retry(it)} className="underline">tentar de novo</button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
