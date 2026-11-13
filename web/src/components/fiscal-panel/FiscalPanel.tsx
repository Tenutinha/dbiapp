import { FilesLink } from "@/components/admin/FilesModal";
import type { FileState } from "@/lib/fiscal/panel";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { FiscalPanelView, PanelFile, PanelModel } from "@/lib/services/fiscal-panel";
import { FileMapGrid } from "./FileMapGrid";
import { count, periodLabel, STATE_LABEL, STATE_ORDER } from "./labels";
import { LineagePanel } from "./LineagePanel";
import { PanelActions } from "./PanelActions";

interface FiscalPanelProps {
  view: FiscalPanelView;
  orgSlug: string;
  /** The space's folder in the file explorer (to send files). */
  filesFolder: string;
}

/** One of the three layers: a title, its main number and what it is. */
function Layer({ step, title, value, children }: { step: number; title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border border-line p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{step}. {title}</p>
      <p className="text-lg font-semibold">{value}</p>
      <div className="text-xs text-muted">{children}</div>
    </div>
  );
}

function StateChips({ counts }: { counts: Record<FileState, number> }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {STATE_ORDER.filter((s) => counts[s] > 0).map((s) => (
        <li key={s} className="flex items-center gap-1.5" title={STATE_LABEL[s].hint}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STATE_LABEL[s].color }} />
          {STATE_LABEL[s].label}: {count(counts[s])}
        </li>
      ))}
    </ul>
  );
}

function FileList({ title, files, tone }: { title: string; files: PanelFile[]; tone: "danger" | "accent" }) {
  if (files.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className={`cursor-pointer ${tone === "danger" ? "text-danger" : "text-accent"}`}>{title} ({count(files.length)})</summary>
      <ul className="mt-1 flex max-h-60 flex-col gap-0.5 overflow-auto text-xs">
        {files.map((f) => (
          <li key={f.key} className="font-mono">
            {periodLabel(f.periodo)} · {f.path} · {formatBytes(f.sizeBytes)}{f.error ? <span className="font-sans text-danger"> — {f.error}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ModelCard({ model, canManage, looseInSpace }: { model: PanelModel; canManage: boolean; looseInSpace: number }) {
  const d = model.dashboard;
  const months = model.map.periods;
  const publishedRows = d?.published.reduce((s, t) => s + t.rows, 0) ?? 0;
  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby={`molde-${model.templateId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`molde-${model.templateId}`} className="text-base font-semibold">{model.title}</h3>
        <span className="text-sm text-muted">{d ? `Dashboard: ${d.name}` : "Nenhum dashboard deste molde vinculado ao espaço"}</span>
      </div>
      {model.error && <p className="text-sm text-danger">{model.error}</p>}

      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        <Layer step={1} title="Arquivos originais" value={`${count(model.files)} arquivo(s)`}>
          {formatBytes(model.sizeBytes)}
          {months.length > 0 ? ` · ${periodLabel(months[0])} a ${periodLabel(months[months.length - 1])}` : ""}
          {` · ${count(model.map.companies.length)} empresa(s)`}
          {model.loose > 0 ? ` · ${count(model.loose)} solto(s) na pasta do molde` : ""}
        </Layer>
        <Layer
          step={2}
          title="Lidos (partes)"
          value={model.mode === "documents" ? "Leitura inteira" : `${count(model.counts.pronto)} de ${count(model.files)}`}
        >
          <StateChips counts={model.counts} />
          {model.mode === "sped" && model.counts.pronto === 0 && (d?.published.length ?? 0) > 0 && (
            <p className="mt-1">As tabelas publicadas foram montadas antes da leitura arquivo a arquivo: os arquivos ainda não têm partes.</p>
          )}
        </Layer>
        <Layer step={3} title="Tabelas publicadas" value={d?.published.length ? `${count(d.published.length)} tabela(s)` : "Nada publicado"}>
          {d?.publishedAt ? `${count(publishedRows)} linhas · publicado em ${formatDateTime(d.publishedAt)}` : "O dashboard ainda não tem dados."}
          {d?.draft ? ` · rascunho com ${count(d.draft.length)} tabela(s) esperando publicação` : ""}
        </Layer>
      </div>

      <FileMapGrid map={model.map} />
      <FileList title="Arquivos com erro" files={model.failed} tone="danger" />
      <FileList title="Grandes demais para a tela (carregados pelo script)" files={model.big} tone="accent" />

      {d && d.published.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Tabelas do dashboard ({count(d.published.length)})</summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Tabela</th>
                <th className="py-1 pr-3 text-right font-normal">Linhas publicadas</th>
                <th className="py-1 pr-3 text-right font-normal">Tamanho</th>
                {d.draft && <th className="py-1 text-right font-normal">No rascunho</th>}
              </tr>
            </thead>
            <tbody>
              {d.published.map((t) => (
                <tr key={t.table} className="border-t border-line">
                  <td className="py-1 pr-3 font-mono">{t.table}</td>
                  <td className="py-1 pr-3 text-right">{count(t.rows)}</td>
                  <td className="py-1 pr-3 text-right">{formatBytes(t.sizeBytes)}</td>
                  {d.draft && <td className="py-1 text-right">{(() => { const x = d.draft?.find((r) => r.table === t.table); return x ? count(x.rows) : "—"; })()}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {d && <LineagePanel dashboardId={d.id} hasDraft={d.draft !== null} canManage={canManage} />}

      {canManage && d && (
        <PanelActions
          dashboardId={d.id}
          mode={model.mode}
          toRead={model.toRead}
          loose={model.loose + looseInSpace}
          hasDraft={d.draft !== null}
        />
      )}
      {canManage && !d && model.files > 0 && (
        <p className="text-sm text-muted">Vincule o dashboard &ldquo;{model.title}&rdquo; a este espaço na Administração para ler estes arquivos e montar as tabelas.</p>
      )}
    </section>
  );
}

/**
 * The panel of fiscal data of a space: for each fiscal model, the path of its files from the original
 * file to the published tables — the map (company × month), the lineage and, for who manages the data,
 * the steps to bring it up to date.
 */
export function FiscalPanel({ view, orgSlug, filesFolder }: FiscalPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-muted">
        O caminho dos arquivos fiscais deste espaço, do arquivo original às tabelas publicadas: o que foi enviado, por empresa e
        mês; o que já foi lido, o que falta e o que deu erro; e de quais arquivos vem cada tabela.
        {view.canManage && (
          <>
            {" "}Envie arquivos pelo explorador de{" "}
            <FilesLink orgSlug={orgSlug} folder={filesFolder} className="font-semibold text-brand-2 hover:underline">📁 Arquivos</FilesLink>.
            {view.looseInSpace > 0 ? ` Há ${count(view.looseInSpace)} arquivo(s) .txt/.xml solto(s) na pasta do espaço.` : ""}
          </>
        )}
      </p>
      {view.maxReadBytes !== null && view.canManage && (
        <p className="text-xs text-muted">Pela tela, cada arquivo pode ter até {formatBytes(view.maxReadBytes)}; os maiores (ECD de centenas de MB) são carregados pelo script.</p>
      )}
      {view.models.length === 0 ? (
        <p className="card p-5 text-sm text-muted">Nenhum arquivo fiscal nem dashboard fiscal neste espaço ainda.</p>
      ) : (
        view.models.map((m) => <ModelCard key={m.templateId} model={m} canManage={view.canManage} looseInSpace={view.looseInSpace} />)
      )}
    </div>
  );
}
