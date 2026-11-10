"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatBytes } from "@/lib/format";

export interface FiscalPeriodView {
  cnpj: string;
  periodo: string;
  files: number;
  sizeBytes: number;
}

interface FiscalImporterProps {
  instanceId: string;
  /** "EFD ICMS/IPI", "NF-e" … */
  title: string;
  /** Accepted extensions, e.g. [".txt"]. */
  extensions: readonly string[];
  initialPeriods: FiscalPeriodView[];
  canUpload: boolean;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

type Plan = { mode: "direct" } | { mode: "signed"; key: string; signedUrl: string };

interface RebuildView {
  ok: boolean;
  files: number;
  adopted: number;
  skipped: { path: string; error: string }[];
  tables: { table: string; ok: boolean; rowCount: number; errors: string[] }[];
}

/** Files sent at the same time (NF-e come by the hundreds). */
const PARALLEL = 4;

async function sendOne(instanceId: string, file: File): Promise<string | null> {
  const base = `/api/instances/${instanceId}/fiscal`;
  const planRes = (await (await fetch(`${base}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, size: file.size }),
  })).json()) as Envelope<Plan>;
  if (!planRes.success || !planRes.data) return planRes.error ?? "Falha no envio.";

  if (planRes.data.mode === "direct") {
    const body = new FormData();
    body.set("file", file);
    const res = (await (await fetch(base, { method: "POST", body })).json()) as Envelope<unknown>;
    return res.success ? null : (res.error ?? "Falha no envio.");
  }
  const put = await fetch(planRes.data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!put.ok) return "Não foi possível enviar o arquivo para o armazenamento.";
  const stored = (await (await fetch(`${base}/store`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: planRes.data.key, fileName: file.name }),
  })).json()) as Envelope<unknown>;
  return stored.success ? null : (stored.error ?? "Falha ao guardar o arquivo.");
}

const periodLabel = (p: string): string => `${p.slice(5, 7)}/${p.slice(0, 4)}`;
const taxIdLabel = (d: string): string =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;

/**
 * Raw fiscal files of a dashboard built on a fiscal template: send SPED (.txt) or NF-e (.xml) files,
 * see what is stored per company and period, and turn everything into the dashboard's tables (draft).
 */
export function FiscalImporter({ instanceId, title, extensions, initialPeriods, canUpload }: FiscalImporterProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [periods, setPeriods] = useState(initialPeriods);
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const [rebuild, setRebuild] = useState<RebuildView | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const refreshList = async (): Promise<void> => {
    const res = (await (await fetch(`/api/instances/${instanceId}/fiscal`)).json()) as Envelope<FiscalPeriodView[]>;
    if (res.success && res.data) setPeriods(res.data);
  };

  const upload = (files: File[]): void => {
    startBusy(async () => {
      setFailures([]);
      setRebuild(null);
      const errors: { name: string; error: string }[] = [];
      let done = 0;
      const queue = [...files];
      const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const error = await sendOne(instanceId, file).catch(() => "Falha de rede.");
          if (error) errors.push({ name: file.name, error });
          done += 1;
          setProgress(`Enviando ${done} de ${files.length}…`);
        }
      };
      setProgress(`Enviando 0 de ${files.length}…`);
      await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
      setFailures(errors);
      setProgress(`${files.length - errors.length} de ${files.length} arquivo(s) guardado(s).`);
      await refreshList();
    });
  };

  const build = (): void => {
    startBusy(async () => {
      setRebuild(null);
      setRebuildError(null);
      setProgress("Lendo os arquivos e montando as tabelas…");
      const res = (await (await fetch(`/api/instances/${instanceId}/fiscal/rebuild`, { method: "POST" })).json()) as Envelope<RebuildView>;
      setProgress(null);
      if (res.data) setRebuild(res.data);
      if (!res.success) setRebuildError(res.error ?? "Não foi possível montar as tabelas.");
      await refreshList();
      router.refresh();
    });
  };

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Arquivos fiscais · {title}</h2>
        <p className="text-sm text-muted">
          Envie os arquivos {extensions.join(" ou ")} como saem do sistema. Guardamos cada um na pasta da empresa e do
          período; reenviar o mesmo período (ou a mesma nota) substitui o anterior. Depois, monte as tabelas e publique.
          Arquivos deste tipo enviados pela etapa Upload do engate, soltos na pasta do espaço, também são reconhecidos e
          organizados ao montar.
        </p>
      </div>

      {canUpload && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            multiple
            accept={extensions.join(",")}
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) upload(files);
            }}
          />
          <button className="btn btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
            Escolher arquivos
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={build}>
            {busy && progress?.startsWith("Lendo") ? "Montando…" : "Montar tabelas"}
          </button>
          {progress && <span className="text-sm text-muted">{progress}</span>}
        </div>
      )}

      {failures.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-danger">
          {failures.slice(0, 20).map((f) => (
            <li key={f.name}>✕ {f.name}: {f.error}</li>
          ))}
          {failures.length > 20 && <li>… e mais {failures.length - 20} arquivo(s) recusado(s).</li>}
        </ul>
      )}

      {rebuild && (
        <div className="flex flex-col gap-1 text-sm">
          <p className={rebuild.ok ? "text-ok" : "text-danger"}>
            {rebuild.ok ? "✓" : "✕"} {rebuild.files.toLocaleString("pt-BR")} arquivo(s) lido(s)
            {rebuild.adopted > 0 ? ` (${rebuild.adopted} vindo(s) da pasta do espaço, agora organizado(s))` : ""}.{" "}
            {rebuild.ok ? "As tabelas estão no rascunho: confira e publique acima." : rebuildError}
          </p>
          {rebuild.tables.map((t) => (
            <p key={t.table} className={t.ok ? "text-muted" : "text-danger"}>
              {t.table}: {t.ok ? `${t.rowCount.toLocaleString("pt-BR")} linhas` : t.errors.join(" ")}
            </p>
          ))}
          {rebuild.skipped.map((s) => (
            <p key={s.path} className="text-accent">⚠ {s.path}: {s.error}</p>
          ))}
        </div>
      )}
      {!rebuild && rebuildError && <p className="text-sm text-danger">✕ {rebuildError}</p>}

      {periods.length === 0 ? (
        <p className="text-sm text-muted">Nenhum arquivo guardado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-4 font-normal">Empresa (CNPJ)</th>
                <th className="py-1 pr-4 font-normal">Período</th>
                <th className="py-1 pr-4 text-right font-normal">Arquivos</th>
                <th className="py-1 text-right font-normal">Tamanho</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={`${p.cnpj}/${p.periodo}`} className="border-t border-line">
                  <td className="py-1 pr-4 font-mono">{taxIdLabel(p.cnpj)}</td>
                  <td className="py-1 pr-4">{periodLabel(p.periodo)}</td>
                  <td className="py-1 pr-4 text-right">{p.files.toLocaleString("pt-BR")}</td>
                  <td className="py-1 text-right">{formatBytes(p.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
