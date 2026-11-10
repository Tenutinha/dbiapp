"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FilesLink } from "@/components/admin/FilesModal";
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
  /** Can build the tables (org staff who manage data). */
  canUpload: boolean;
  /** Where the space's files live in the explorer (to send new ones there). */
  files: { orgSlug: string; folder: string };
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface RebuildView {
  ok: boolean;
  files: number;
  adopted: number;
  skipped: { path: string; error: string }[];
  tables: { table: string; ok: boolean; rowCount: number; errors: string[] }[];
}

const periodLabel = (p: string): string => `${p.slice(5, 7)}/${p.slice(0, 4)}`;
const taxIdLabel = (d: string): string =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;

/**
 * Raw fiscal files of a dashboard built on a fiscal template: what is stored per company and period, and
 * turning everything into the dashboard's tables (draft). Files are sent in the "Arquivos" explorer.
 */
export function FiscalImporter({ instanceId, title, extensions, initialPeriods, canUpload, files }: FiscalImporterProps) {
  const router = useRouter();
  const [periods, setPeriods] = useState(initialPeriods);
  const [progress, setProgress] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState<RebuildView | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const refreshList = async (): Promise<void> => {
    const res = (await (await fetch(`/api/instances/${instanceId}/fiscal`)).json()) as Envelope<FiscalPeriodView[]>;
    if (res.success && res.data) setPeriods(res.data);
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
          Envie os arquivos {extensions.join(" ou ")} como saem do sistema pelo explorador de{" "}
          <FilesLink orgSlug={files.orgSlug} folder={files.folder} className="font-semibold text-brand-2 hover:underline">📁 Arquivos</FilesLink>, na pasta
          do espaço. Ao montar, cada um é reconhecido e organizado por empresa e período (o mesmo período ou a mesma nota
          substitui o anterior). Depois, publique.
        </p>
      </div>

      {canUpload && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={busy} onClick={build}>
            {busy && progress?.startsWith("Lendo") ? "Montando…" : "Montar tabelas"}
          </button>
          {progress && <span className="text-sm text-muted">{progress}</span>}
        </div>
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
