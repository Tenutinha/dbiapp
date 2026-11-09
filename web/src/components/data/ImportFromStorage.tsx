"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { TableReport } from "@/lib/ingest/ingest";

interface FolderMatch {
  table: string;
  fileName: string;
  sizeBytes: number;
}

interface FolderResult {
  folder: string;
  matches: FolderMatch[];
  missing: string[];
  reports?: TableReport[];
}

interface Envelope {
  success: boolean;
  data?: FolderResult;
  error?: string;
}

export interface ImportFromStorageProps {
  instanceId: string;
  orgSlug: string;
  /** Sub-folders suggested in the field (e.g. preparado/deputados). */
  suggestions: string[];
}

type State =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "preview"; data: FolderResult }
  | { kind: "done"; data: FolderResult }
  | { kind: "error"; message: string; data?: FolderResult };

async function call(instanceId: string, folder: string, importar: boolean): Promise<Envelope> {
  const res = await fetch(`/api/instances/${instanceId}/upload/from-storage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, importar }),
  });
  return (await res.json()) as Envelope;
}

/**
 * Feeds the draft from files already in the organization's storage folder: the server lists the
 * folder, matches files named after the contract tables and validates them like an upload.
 */
export function ImportFromStorage({ instanceId, orgSlug, suggestions }: ImportFromStorageProps) {
  const router = useRouter();
  const [folder, setFolder] = useState(suggestions[0] ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy";

  async function run(importar: boolean): Promise<void> {
    setState({ kind: "busy", step: importar ? "Importando e validando" : "Procurando arquivos" });
    try {
      const json = await call(instanceId, folder, importar);
      if (!json.success || !json.data) {
        setState({ kind: "error", message: json.error ?? "Falha ao ler a pasta.", data: json.data });
        return;
      }
      setState({ kind: importar ? "done" : "preview", data: json.data });
      if (importar) router.refresh();
    } catch {
      setState({ kind: "error", message: "Não foi possível falar com o servidor. Verifique a conexão." });
    }
  }

  const data = state.kind === "preview" || state.kind === "done" || state.kind === "error" ? state.data : undefined;
  const reportFor = (table: string): TableReport | undefined => data?.reports?.find((r) => r.table === table);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Importar do armazenamento da organização</h2>
        <p className="mt-1 text-xs text-muted">
          Use arquivos que já estão no bucket, em <code className="font-mono">orgs/{orgSlug}/</code>. Cada arquivo com o nome de
          uma tabela (por exemplo <code className="font-mono">f_votacao.parquet</code>) entra no rascunho, com a mesma validação do envio.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(false);
        }}
      >
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-sm focus-within:border-brand">
          <span className="shrink-0 font-mono text-xs text-muted">orgs/{orgSlug}/</span>
          <input
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setState({ kind: "idle" });
            }}
            list="pastas-armazenamento"
            placeholder="preparado/presidente"
            aria-label="Pasta no armazenamento da organização"
            className="min-w-0 flex-1 bg-transparent py-2 font-mono outline-none"
          />
          <datalist id="pastas-armazenamento">
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </label>
        <button type="submit" disabled={busy || folder.trim() === ""} className="btn btn-ghost">Procurar</button>
      </form>

      {busy && <p className="text-sm text-muted">{state.step}…</p>}
      {state.kind === "error" && <p className="text-sm text-danger">{state.message}</p>}

      {data && (
        <ul className="flex flex-col gap-1 text-sm">
          {data.matches.map((m) => {
            const r = reportFor(m.table);
            return (
              <li key={m.table} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <code className="font-mono">{m.table}</code>
                  <span className="text-muted"> ← {m.fileName} · {formatBytes(m.sizeBytes)}</span>
                </span>
                {r && (r.ok
                  ? <span className="text-ok">✓ {r.rowCount.toLocaleString("pt-BR")} linhas</span>
                  : <span className="text-danger">{r.errors[0] ?? "recusado"}</span>)}
              </li>
            );
          })}
          {data.missing.map((t) => (
            <li key={t} className="flex justify-between gap-2 text-muted">
              <code className="font-mono">{t}</code>
              <span>sem arquivo nessa pasta</span>
            </li>
          ))}
        </ul>
      )}

      {state.kind === "preview" && state.data.matches.length > 0 && (
        <button type="button" onClick={() => void run(true)} className="btn btn-primary self-start">
          Importar {state.data.matches.length} {state.data.matches.length === 1 ? "tabela" : "tabelas"}
        </button>
      )}
      {state.kind === "done" && (
        <p className="text-sm text-ok">Importado para o rascunho. Confira acima e publique quando estiver pronto.</p>
      )}
    </section>
  );
}
