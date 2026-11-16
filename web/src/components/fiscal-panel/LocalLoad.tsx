"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildStatus } from "@/lib/fiscal/build-status";
import type { FolderCheck, LiveCount, LoadLog, LocalLoadPhase } from "@/lib/fiscal/local-load";
import { formatBytes } from "@/lib/format";
import { BuildBanner } from "./BuildBanner";
import { count, periodLabel } from "./labels";

interface LoadView {
  run: { folder: string; startedAt: string; phase: LocalLoadPhase } | null;
  log: LoadLog | null;
  build: BuildStatus | null;
  check: FolderCheck | null;
}

interface Envelope {
  success: boolean;
  data?: LoadView;
  error?: string;
}

interface LocalLoadProps {
  dashboardId: string;
  /** The folder suggested when none was used yet on this machine. */
  defaultFolder: string;
}

/** While a load runs, how often the screen asks where it is. */
const POLL_MS = 4000;

async function call(url: string, init?: RequestInit): Promise<Envelope> {
  try {
    return (await (await fetch(url, init)).json()) as Envelope;
  } catch {
    return { success: false, error: "Sem conexão com o servidor." };
  }
}

function Bar({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="h-full bg-brand-2 transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Check({ check }: { check: FolderCheck }) {
  const download = check.toRead - check.toReadFromLocal;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
      <div><dt className="text-muted">Arquivos .txt na pasta</dt><dd className="text-sm font-semibold">{count(check.localFiles)}</dd></div>
      <div><dt className="text-muted">No bucket deste dashboard</dt><dd className="text-sm font-semibold">{count(check.stored)}</dd></div>
      <div><dt className="text-muted">Com cópia nesta pasta</dt><dd className="text-sm font-semibold">{count(check.storedWithLocal)}</dd></div>
      <div>
        <dt className="text-muted">Faltam ler</dt>
        <dd className="text-sm font-semibold">{count(check.toRead)}</dd>
        {check.toRead > 0 && (
          <dd className="text-muted">{count(check.toReadFromLocal)} do disco{download > 0 ? ` · ${count(download)} baixado(s) do bucket` : ""}</dd>
        )}
      </div>
    </dl>
  );
}

function Number({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const cnpjLabel = (cnpj: string): string =>
  cnpj.length === 14 ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : cnpj;

/** The count as the load goes: what was read so far, the lines of each table, and the files as they end. */
function Live({ live, running }: { live: LiveCount; running: boolean }) {
  const biggest = live.byTable[0]?.rows ?? 0;
  return (
    <div className="flex flex-col gap-3" aria-live="off">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Number label="Arquivos lidos nesta rodada" value={count(live.files - live.failed)} />
        <Number label="Linhas lidas" value={count(live.rows)} />
        <Number label="Volume lido" value={formatBytes(live.bytes)} />
        <Number label="Arquivos com erro" value={count(live.failed)} />
      </dl>

      {live.byTable.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Linhas por tabela {running ? "(somando enquanto lê)" : ""}</p>
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Tabela</th>
                <th className="py-1 pr-3 text-right font-normal">Linhas</th>
                <th className="py-1 pr-3 text-right font-normal">Arquivos</th>
                <th className="w-1/3 py-1 font-normal"><span className="sr-only">Proporção</span></th>
              </tr>
            </thead>
            <tbody>
              {live.byTable.map((t) => (
                <tr key={t.table} className="border-t border-line">
                  <td className="py-1 pr-3 font-mono">{t.table}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{count(t.rows)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{count(t.files)}</td>
                  <td className="py-1">
                    <div className="h-1.5 rounded-full bg-brand-2/70" style={{ width: `${biggest > 0 ? Math.max((t.rows / biggest) * 100, 1) : 0}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {live.assembled.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Tabelas finais já montadas</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {live.assembled.map((t) => (
              <li key={t.table} className={t.ok ? "" : "text-danger"}>
                {t.ok ? "✓" : "✕"} <span className="font-mono">{t.table}</span> · {count(t.rows)} linhas · {formatBytes(t.sizeBytes)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {live.recent.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Últimos arquivos lidos</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {live.recent.map((f) => {
              const rows = Object.values(f.rows).reduce((sum, n) => sum + n, 0);
              return (
                <li key={`${f.cnpj}/${f.periodo}/${f.sizeBytes}`} className={f.ok ? "" : "text-danger"}>
                  {f.ok ? "✓" : "✕"} <span className="font-mono">{cnpjLabel(f.cnpj)}</span> · {periodLabel(f.periodo)} · {formatBytes(f.sizeBytes)}
                  {f.ok ? ` · ${count(rows)} linhas` : ` — ${f.error ?? "não foi possível ler"}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Progress({ view, now }: { view: LoadView; now: number }) {
  const { run, log, build } = view;
  if (!run || !log) return null;
  const startedAt = new Date(run.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return (
    <div className="flex flex-col gap-2">
      {run.phase === "rodando" && build && <BuildBanner status={build} now={now} />}
      {run.phase === "rodando" && !build && (
        <p className="text-sm font-semibold" role="status">
          <span aria-hidden className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-2 align-middle" />
          Conversão iniciada; preparando a lista de arquivos…
        </p>
      )}
      {run.phase === "concluida" && <p className="text-sm font-semibold text-ok" role="status">✓ Conversão concluída e publicada.</p>}
      {run.phase === "falhou" && (
        <p className="text-sm font-semibold text-danger" role="status">✕ A conversão parou antes de publicar. Veja as últimas linhas abaixo e converta de novo: o que já foi lido é reaproveitado.</p>
      )}
      <p className="text-xs text-muted">Pasta: <span className="font-mono">{run.folder}</span> · iniciada em {startedAt}</p>

      {log.read && (
        <div className="flex flex-col gap-1">
          <p className="text-xs">Arquivos lidos: {count(log.read.done)} de {count(log.read.total)} · {log.read.minutes.toLocaleString("pt-BR")} min</p>
          <Bar value={log.read.total > 0 ? log.read.done / log.read.total : 0} />
        </div>
      )}
      {log.live && <Live live={log.live} running={run.phase === "rodando"} />}
      {log.summary && <p className="text-xs">{log.summary}</p>}
      {log.tables.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted">
            <tr><th className="py-1 pr-3 font-normal">Tabela gerada</th><th className="py-1 font-normal">Resultado</th></tr>
          </thead>
          <tbody>
            {log.tables.map((t) => (
              <tr key={t.table} className="border-t border-line">
                <td className="py-1 pr-3 font-mono">{t.table}</td>
                <td className={`py-1 ${t.ok ? "" : "text-danger"}`}>{t.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {log.warnings.map((w) => <p key={w} className="text-xs text-accent">⚠ {w}</p>)}
      {log.tail.length > 0 && (
        <details className="text-xs" open={run.phase === "falhou"}>
          <summary className="cursor-pointer text-muted">Últimas linhas da conversão</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-bg-2/60 p-2 font-mono">{log.tail.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * "Converter nesta máquina" (local server only): names the folder that keeps the original files, checks it
 * against the dashboard's files, starts the load and follows it — files read, each table, the publication.
 */
export function LocalLoad({ dashboardId, defaultFolder }: LocalLoadProps) {
  const router = useRouter();
  const url = `/api/instances/${dashboardId}/fiscal/carga-local`;
  const [folder, setFolder] = useState(defaultFolder);
  const [view, setView] = useState<LoadView | null>(null);
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [busy, setBusy] = useState<null | "conferir" | "iniciar" | "parar">(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastPhase = useRef<LocalLoadPhase | null>(null);

  const apply = useCallback((res: Envelope): boolean => {
    if (!res.success || !res.data) {
      setError(res.error ?? "Não foi possível falar com o servidor local.");
      return false;
    }
    setError(null);
    setView(res.data);
    setNow(Date.now());
    if (res.data.check) setCheck(res.data.check);
    return true;
  }, []);

  // What is on this machine when the panel opens: a load may be running since before.
  useEffect(() => {
    let cancelled = false;
    void call(url).then((res) => {
      if (cancelled || !res.success || !res.data) return;
      setView(res.data);
      const used = res.data.run?.folder;
      if (used) setFolder((current) => current || used);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const phase = view?.run?.phase ?? null;
  useEffect(() => {
    if (phase !== "rodando") return;
    const id = window.setInterval(() => void call(url).then(apply), POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, url, apply]);

  // When the load ends, the panel around (the map, the published tables) is asked again.
  useEffect(() => {
    if (lastPhase.current === "rodando" && phase !== "rodando") router.refresh();
    lastPhase.current = phase;
  }, [phase, router]);

  const verify = async (): Promise<void> => {
    setBusy("conferir");
    setCheck(null);
    apply(await call(`${url}?pasta=${encodeURIComponent(folder)}`));
    setBusy(null);
  };

  const start = async (): Promise<void> => {
    if (!window.confirm("Converter os arquivos nesta máquina? Ao terminar, as tabelas são publicadas no dashboard.")) return;
    setBusy("iniciar");
    apply(await call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pasta: folder }) }));
    setBusy(null);
  };

  const stop = async (): Promise<void> => {
    if (!window.confirm("Parar a conversão? O que já foi lido fica guardado.")) return;
    setBusy("parar");
    apply(await call(url, { method: "DELETE" }));
    setBusy(null);
  };

  const running = phase === "rodando";
  const inputId = `pasta-${dashboardId}`;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-bg-2/40 p-3">
      <div>
        <p className="text-sm font-semibold">Converter nesta máquina</p>
        <p className="text-xs text-muted">
          Lê os arquivos originais da pasta deste computador (só os que têm o mesmo conteúdo dos enviados; os demais são baixados),
          gera as tabelas em Parquet e publica. Roda fora do navegador: pode fechar esta página e voltar depois.
        </p>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <label htmlFor={inputId} className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Pasta dos arquivos originais
          <input
            id={inputId}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="C:\pasta\dos\arquivos"
            disabled={running || busy !== null}
            spellCheck={false}
          />
        </label>
        <button type="button" className="btn btn-ghost" disabled={running || busy !== null || folder.trim() === ""} onClick={() => void verify()}>
          {busy === "conferir" ? "Conferindo…" : "Conferir pasta"}
        </button>
        {running ? (
          <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void stop()}>
            {busy === "parar" ? "Parando…" : "Parar"}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy !== null || folder.trim() === ""} onClick={() => void start()}>
            {busy === "iniciar" ? "Iniciando…" : "Converter e publicar"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-danger" aria-live="polite">✕ {error}</p>}
      {check && !running && <Check check={check} />}
      {view && <Progress view={view} now={now} />}
    </div>
  );
}
