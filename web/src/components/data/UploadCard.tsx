"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { TableReport } from "@/lib/ingest/ingest";

interface ContractColumn {
  name: string;
  type: string;
  required: boolean;
}

export interface UploadCardProps {
  instanceId: string;
  table: { name: string; kind: "fact" | "dimension"; description: string; key?: string; columns: ContractColumn[] };
  status: { label: string; tone: "ok" | "draft" | "missing" };
  canUpload: boolean;
}

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "done"; report: TableReport }
  | { kind: "error"; message: string; report?: TableReport };

const TONE = { ok: "text-ok", draft: "text-brand-2", missing: "text-accent" } as const;

export function UploadCard({ instanceId, table, status, canUpload }: UploadCardProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File): Promise<void> {
    setState({ kind: "uploading", fileName: file.name });
    const body = new FormData();
    body.set("table", table.name);
    body.set("file", file);
    try {
      const res = await fetch(`/api/instances/${instanceId}/upload`, { method: "POST", body });
      const json = (await res.json()) as { success: boolean; data?: TableReport; error?: string };
      if (json.success && json.data) {
        setState({ kind: "done", report: json.data });
        router.refresh();
      } else {
        setState({ kind: "error", message: json.error ?? "Falha no envio.", report: json.data });
      }
    } catch {
      setState({ kind: "error", message: "Não foi possível enviar o arquivo. Verifique a conexão." });
    }
  }

  const busy = state.kind === "uploading";
  const report = state.kind === "done" || state.kind === "error" ? state.report : undefined;

  return (
    <article className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <code className={`font-mono text-sm font-bold ${table.kind === "fact" ? "text-brand" : ""}`}>{table.name}</code>
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
              {table.kind === "fact" ? "fato" : "dimensão"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{table.description}</p>
        </div>
        <span className={`shrink-0 text-xs ${TONE[status.tone]}`}>{status.label}</span>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted hover:text-text">Contrato: {table.columns.length} colunas</summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
          {table.columns.map((c) => (
            <li key={c.name} className="flex justify-between gap-2">
              <span className={c.required ? "" : "text-muted"}>
                {c.name}
                {c.name === table.key ? " 🔑" : ""}
                {!c.required ? " (opcional)" : ""}
              </span>
              <span className="text-muted">{c.type}</span>
            </li>
          ))}
        </ul>
      </details>

      {canUpload && (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={`rounded-xl border border-dashed px-4 py-5 text-sm transition ${
            dragging ? "border-brand bg-brand/10" : "border-line hover:border-brand/60"
          }`}
        >
          {busy ? `Validando ${state.fileName}…` : "Arraste um .parquet ou .csv, ou clique para escolher"}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept=".parquet,.csv,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />

      {state.kind === "done" && (
        <p className="text-xs text-ok">✓ {state.report.rowCount.toLocaleString("pt-BR")} linhas validadas e convertidas.</p>
      )}
      {state.kind === "error" && <p className="text-xs text-danger">✕ {state.message}</p>}
      {report && report.errors.length > 1 && (
        <ul className="list-disc pl-5 text-xs text-danger">
          {report.errors.slice(1).map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {report && report.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-accent">
          {report.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </article>
  );
}
