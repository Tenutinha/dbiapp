"use client";

import { useState } from "react";
import type { LineageSource } from "@/lib/fiscal/lineage";
import type { LineageTableView } from "@/lib/fiscal/panel";
import { formatBytes, formatDateTime } from "@/lib/format";
import { count, periodLabel, taxIdLabel } from "./labels";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface LineageData {
  builtAt: string;
  reader: number;
  tables: LineageTableView[];
}

interface SourcesPage {
  total: number;
  offset: number;
  limit: number;
  sources: LineageSource[];
}

type Version = "publicada" | "rascunho";

async function getJson<T>(url: string): Promise<Envelope<T>> {
  try {
    return (await (await fetch(url)).json()) as Envelope<T>;
  } catch {
    return { success: false, error: "Sem conexão. Tente de novo." };
  }
}

/** The files one table came from, a page at a time. */
function Sources({ dashboardId, version, table }: { dashboardId: string; version: Version; table: string }) {
  const [pages, setPages] = useState<SourcesPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = pages.flatMap((p) => p.sources);
  const total = pages[0]?.total ?? null;

  const load = async (offset: number): Promise<void> => {
    setLoading(true);
    const res = await getJson<SourcesPage>(`/api/instances/${dashboardId}/fiscal/linhagem?versao=${version}&tabela=${encodeURIComponent(table)}&offset=${offset}`);
    setLoading(false);
    if (res.success && res.data) setPages((prev) => [...prev, res.data as SourcesPage]);
    else setError(res.error ?? "Não foi possível carregar os arquivos.");
  };

  if (pages.length === 0) {
    return (
      <button type="button" className="w-fit text-sm font-semibold text-brand-2 hover:underline" disabled={loading} onClick={() => void load(0)}>
        {loading ? "Carregando…" : "Ver os arquivos"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="max-h-80 overflow-auto rounded-md border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted">
            <tr>
              <th className="px-2 py-1 font-normal">Mês</th>
              <th className="px-2 py-1 font-normal">Empresa</th>
              <th className="px-2 py-1 font-normal">Arquivo original</th>
              <th className="px-2 py-1 text-right font-normal">Linhas na tabela</th>
              <th className="px-2 py-1 text-right font-normal">Tamanho</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={`${s.file}|${s.periodo}`} className="border-t border-line">
                <td className="px-2 py-1">{periodLabel(s.periodo)}</td>
                <td className="px-2 py-1 font-mono">{taxIdLabel(s.cnpj)}</td>
                <td className="max-w-[28rem] truncate px-2 py-1 font-mono" title={s.file}>{s.file}</td>
                <td className="px-2 py-1 text-right">{count(s.rows)}</td>
                <td className="px-2 py-1 text-right">{formatBytes(s.sizeBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total !== null && shown.length < total && (
        <button type="button" className="w-fit text-sm font-semibold text-brand-2 hover:underline" disabled={loading} onClick={() => void load(shown.length)}>
          {loading ? "Carregando…" : `Mostrar mais (${count(shown.length)} de ${count(total)})`}
        </button>
      )}
    </div>
  );
}

/**
 * Where the numbers of a fiscal dashboard come from: for each table, how it is made (in words) and from
 * which original files, read from the linhagem.json kept next to its tables.
 */
export function LineagePanel({ dashboardId, hasDraft, canManage }: { dashboardId: string; hasDraft: boolean; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<Version>("publicada");
  const [data, setData] = useState<Record<string, LineageData | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (v: Version): Promise<void> => {
    setVersion(v);
    setOpen(true);
    if (v in data) return;
    setLoading(true);
    setError(null);
    const res = await getJson<LineageData | null>(`/api/instances/${dashboardId}/fiscal/linhagem?versao=${v}`);
    setLoading(false);
    if (res.success) setData((prev) => ({ ...prev, [v]: res.data ?? null }));
    else setError(res.error ?? "Não foi possível carregar a linhagem.");
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost w-fit" onClick={() => void load("publicada")}>
        De onde vêm estes números (linhagem)
      </button>
    );
  }
  const lineage = data[version];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold">Linhagem</h4>
        {canManage && hasDraft && (
          <div className="flex gap-1 text-sm" role="group" aria-label="Versão">
            {(["publicada", "rascunho"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`rounded-full border px-3 py-0.5 ${version === v ? "border-brand-2 text-brand-2" : "border-line text-muted"}`}
                aria-pressed={version === v}
                onClick={() => void load(v)}
              >
                {v === "publicada" ? "Publicada" : "Rascunho"}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="text-sm text-muted hover:underline" onClick={() => setOpen(false)}>Fechar</button>
      </div>
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && version in data && !lineage && (
        <p className="text-sm text-muted">
          Sem linhagem para esta versão: as tabelas foram montadas antes de a linhagem existir. Ela aparece na próxima montagem.
        </p>
      )}
      {lineage && (
        <>
          <p className="text-xs text-muted">Montada em {formatDateTime(lineage.builtAt)} · versão do leitor {lineage.reader}</p>
          <ul className="flex flex-col gap-2">
            {lineage.tables.map((t) => (
              <li key={t.table} className="rounded-md border border-line p-3">
                <details>
                  <summary className="cursor-pointer list-none">
                    <span className="font-mono text-sm font-semibold">{t.table}</span>{" "}
                    <span className="text-xs text-muted">
                      {t.kind === "fact" ? "fato" : "cadastro"} · {t.rows === null ? "com erro" : `${count(t.rows)} linhas`} · de {count(t.files)} arquivo(s)
                      {t.companies > 0 ? `, ${count(t.companies)} empresa(s)` : ""}
                      {t.from && t.to ? `, ${periodLabel(t.from)}${t.from !== t.to ? ` a ${periodLabel(t.to)}` : ""}` : ""}
                    </span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <ul className="list-disc pl-5 text-sm">
                      {t.how.map((h) => <li key={h}>{h}</li>)}
                    </ul>
                    {t.kind === "fact" && (
                      <p className="text-xs text-muted">
                        Cada linha guarda a sua origem: as colunas <code>arquivo</code> (empresa e mês) e <code>linha</code> (a linha no arquivo original; 0 nas linhas somadas).
                      </p>
                    )}
                    <Sources dashboardId={dashboardId} version={version} table={t.table} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
