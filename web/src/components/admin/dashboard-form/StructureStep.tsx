"use client";

import { useState } from "react";
import { removeVisual, uniqueId } from "@/lib/templates/draft";
import type { Template, Visual } from "@/lib/templates/schema";
import { buildStructure, looseVisuals, type StructureRow } from "@/lib/templates/structure";
import { AnalysisEditor, visualTitle } from "./AnalysisEditor";
import { FilesStep } from "./FilesStep";
import { FormModal } from "./FormModal";
import { ModelStep } from "./ModelStep";
import { SummaryStep } from "./SummaryStep";
import { Select } from "./ui";
import { VisualEditor } from "./VisualEditor";

interface StepProps {
  template: Template;
  onChange: (t: Template) => void;
}

type Open =
  | { kind: "analysis"; id: string }
  | { kind: "visual"; id: string }
  | { kind: "files" }
  | { kind: "fields" }
  | { kind: "summary" };

const TH = "px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted";
const TD = "px-3 py-2.5 align-top text-sm";
const HEAD_ACTION = "ml-2 font-normal normal-case tracking-normal text-brand-2 hover:underline";
/** Charts listed per row before "+N mais" (a SPED block can have dozens). */
const SHOWN_VISUALS = 6;
const CHIP ="inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-xs";

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
    </svg>
  );
}

/**
 * Everything after "Geral", in one table like the organization's admin: the summary as a hierarchy
 * (topic → analysis), and for each analysis the files it reads, its charts and its fields. Clicking an
 * item edits it in a centered modal; the column headers open the full lists.
 */
export function StructureStep({ template: t, onChange }: StepProps) {
  const [open, setOpen] = useState<Open | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const close = (): void => setOpen(null);
  const toggleExpanded = (id: string): void =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const groups = buildStructure(t);
  const loose = looseVisuals(t);
  const visual = open?.kind === "visual" ? t.visuals.find((v) => v.id === open.id) : undefined;

  const addAnalysis = (): void => {
    const id = uniqueId("analise", t.analyses.map((a) => a.id));
    const analyses = [...t.analyses, { id, title: "", description: "", visuals: [], hidden: false }];
    // Listed in the last topic (or a first one), so it shows in the summary right away.
    const summary = t.summary.length > 0
      ? t.summary.map((g, i) => (i === t.summary.length - 1 ? { ...g, analyses: [...g.analyses, id] } : g))
      : [{ title: "Análises", analyses: [id] }];
    onChange({ ...t, analyses, summary });
    setOpen({ kind: "analysis", id });
  };
  const toggleHidden = (id: string): void =>
    onChange({ ...t, analyses: t.analyses.map((a) => (a.id === id ? { ...a, hidden: !a.hidden } : a)) });

  const row = (r: StructureRow) => (
    <tr key={r.analysis.id} className={`border-t border-line/60 ${r.analysis.hidden ? "bg-accent/5" : ""}`}>
      <td className={`${TD} pl-6`}>
        <div className="flex items-start gap-2">
          <span className="w-5 shrink-0 pt-px font-mono text-xs tabular-nums text-muted">{r.number ? String(r.number).padStart(2, "0") : "—"}</span>
          <button type="button" onClick={() => setOpen({ kind: "analysis", id: r.analysis.id })} className="min-w-0 text-left font-medium hover:text-brand-2 hover:underline">
            {r.analysis.title || "(sem título)"}
          </button>
          <button
            type="button"
            onClick={() => toggleHidden(r.analysis.id)}
            title={r.analysis.hidden ? "Oculta (fora do ar): clique para voltar" : "Ocultar do sumário (fora do ar)"}
            aria-pressed={r.analysis.hidden}
            className={`ml-auto shrink-0 rounded p-1 ${r.analysis.hidden ? "text-accent" : "text-muted/50 hover:text-text"}`}
          >
            <EyeOffIcon />
          </button>
        </div>
        {r.analysis.hidden && <p className="ml-7 mt-0.5 text-[11px] text-accent">Oculta: fora do ar</p>}
      </td>
      <td className={TD}>
        <div className="flex flex-wrap gap-1">
          {r.tables.length === 0 ? <span className="text-xs text-muted">—</span> : r.tables.map((name) => (
            <button key={name} type="button" onClick={() => setOpen({ kind: "files" })} className={`${CHIP} border-line font-mono hover:border-brand`}>{name}</button>
          ))}
        </div>
      </td>
      <td className={TD}>
        <div className="flex flex-col items-start gap-1">
          {(expanded.has(r.analysis.id) ? r.visuals : r.visuals.slice(0, SHOWN_VISUALS)).map((v) => (
            <button key={v.id} type="button" onClick={() => setOpen({ kind: "visual", id: v.id })} className="max-w-full truncate text-left text-xs hover:text-brand-2 hover:underline">
              {visualTitle(v)}
            </button>
          ))}
          {r.visuals.length > SHOWN_VISUALS && (
            <button type="button" onClick={() => toggleExpanded(r.analysis.id)} className="text-xs text-muted hover:text-text">
              {expanded.has(r.analysis.id) ? "mostrar menos" : `+${r.visuals.length - SHOWN_VISUALS} mais`}
            </button>
          )}
          <button type="button" onClick={() => setOpen({ kind: "analysis", id: r.analysis.id })} className="text-xs text-muted hover:text-brand-2">+ gráfico</button>
        </div>
      </td>
      <td className={TD}>
        <div className="flex flex-wrap gap-1">
          {r.used.length === 0 ? <span className="text-xs text-muted">—</span> : r.used.map((u) => (
            <button
              key={`${u.kind}:${u.id}`}
              type="button"
              onClick={() => setOpen({ kind: "fields" })}
              title={u.kind === "measure" ? "Medida" : "Campo"}
              className={`${CHIP} ${u.kind === "measure" ? "border-brand/40 bg-brand/10" : "border-line"} hover:border-brand`}
            >
              {u.label}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        O sumário do dashboard e, para cada análise, os arquivos que ela lê, os gráficos e os campos. Clique num item para editar.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="bg-bg/60">
            <tr>
              <th className={`${TH} w-[30%]`}>
                1 · Sumário
                <button type="button" onClick={() => setOpen({ kind: "summary" })} className={HEAD_ACTION}>Organizar</button>
                <button type="button" onClick={addAnalysis} className={HEAD_ACTION}>+ análise</button>
              </th>
              <th className={`${TH} w-[18%]`}>
                2 · Arquivos
                <button type="button" onClick={() => setOpen({ kind: "files" })} className={HEAD_ACTION}>Ver todos ({t.tables.length})</button>
              </th>
              <th className={`${TH} w-[27%]`}>3 · Análises</th>
              <th className={`${TH} w-[25%]`}>
                4 · Campos
                <button type="button" onClick={() => setOpen({ kind: "fields" })} className={HEAD_ACTION}>
                  Ver todos ({t.fields.length + t.measures.length})
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {loose.length > 0 && (
              <tr className="border-t border-line bg-accent/5">
                <td className={TD} colSpan={2}>
                  <p className="font-medium">Gráficos fora das análises</p>
                  <p className="text-xs text-muted">Aparecem no topo da página, antes da primeira análise.</p>
                </td>
                <td className={TD} colSpan={2}>
                  <div className="flex flex-col items-start gap-1">
                    {loose.map((v) => (
                      <button key={v.id} type="button" onClick={() => setOpen({ kind: "visual", id: v.id })} className="text-left text-xs hover:text-brand-2 hover:underline">
                        {visualTitle(v)}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )}
            {groups.map((g) => [
              <tr key={`g-${g.index ?? "fora"}`} className="border-t border-line bg-bg/40">
                <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-muted">
                  {g.title ?? (t.summary.length > 0
                    ? "Fora do sumário: fora do ar, não aparecem no dashboard (inclua no sumário em “Organizar”)"
                    : "Sem sumário: todas as análises aparecem no dashboard")}
                </td>
              </tr>,
              ...g.rows.map(row),
            ])}
            {groups.length === 0 && loose.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-muted">Nenhuma análise ainda. Use “+ análise”.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open?.kind === "analysis" && (
        <FormModal title={t.analyses.find((a) => a.id === open.id)?.title || "Análise"} subtitle="Análise do dashboard" onClose={close}>
          <AnalysisEditor template={t} analysisId={open.id} onChange={onChange} onRemoved={close} />
        </FormModal>
      )}
      {open?.kind === "visual" && (
        <FormModal title={visual ? visualTitle(visual) : "Gráfico"} subtitle="Gráfico" onClose={close}>
          {visual ? <VisualModalBody t={t} visual={visual} onChange={onChange} onRemoved={close} /> : <p className="text-sm text-muted">Este gráfico foi removido.</p>}
        </FormModal>
      )}
      {open?.kind === "files" && (
        <FormModal title="Arquivos" subtitle="As tabelas que o dashboard espera e como se ligam" onClose={close} wide>
          <FilesStep template={t} onChange={onChange} />
        </FormModal>
      )}
      {open?.kind === "fields" && (
        <FormModal title="Campos e medidas" subtitle="O que os gráficos e filtros usam" onClose={close} wide>
          <ModelStep template={t} onChange={onChange} />
        </FormModal>
      )}
      {open?.kind === "summary" && (
        <FormModal title="Organizar o sumário" subtitle="Tópicos e a ordem das análises na barra lateral" onClose={close}>
          <SummaryStep template={t} onChange={onChange} />
        </FormModal>
      )}
    </div>
  );
}

function VisualModalBody({ t, visual, onChange, onRemoved }: { t: Template; visual: Visual; onChange: (t: Template) => void; onRemoved: () => void }) {
  const owner = t.analyses.find((a) => a.visuals.includes(visual.id));
  const options = t.analyses.map((a) => ({ value: a.id, label: a.title || "(análise sem título)" }));
  const moveTo = (analysisId: string): void =>
    onChange({
      ...t,
      analyses: t.analyses.map((a) => {
        const without = a.visuals.filter((id) => id !== visual.id);
        return a.id === analysisId ? { ...a, visuals: [...without, visual.id] } : { ...a, visuals: without };
      }),
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Na análise</span>
        <span className="w-56">
          <Select value={owner?.id ?? ""} empty="Fora das análises" options={options} ariaLabel="Análise do gráfico" onChange={(id) => id && moveTo(id)} />
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(removeVisual(t, visual.id));
            onRemoved();
          }}
          className="ml-auto text-xs text-muted hover:text-danger"
        >
          Remover gráfico
        </button>
      </div>
      <VisualEditor visual={visual} template={t} onChange={(v) => onChange({ ...t, visuals: t.visuals.map((x) => (x.id === v.id ? v : x)) })} />
    </div>
  );
}
