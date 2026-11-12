"use client";

import { defaultVisual, moveAt, removeAnalysis, removeVisual, replaceAt, uniqueId } from "@/lib/templates/draft";
import type { Analysis, Template, Visual } from "@/lib/templates/schema";
import { AddButton, Field, ItemCard, TextArea, TextInput } from "./ui";
import { VISUAL_TYPE_LABEL, VisualEditor } from "./VisualEditor";

interface AnalysisEditorProps {
  template: Template;
  analysisId: string;
  onChange: (t: Template) => void;
  /** After "Remover análise" (the modal closes). */
  onRemoved: () => void;
}

export const visualTitle = (v: Visual): string => `${v.title || "(sem título)"} · ${VISUAL_TYPE_LABEL[v.type]}`;

/** One analysis: title, text, off the air, and its charts in order (each editable in place). */
export function AnalysisEditor({ template: t, analysisId, onChange, onRemoved }: AnalysisEditorProps) {
  const i = t.analyses.findIndex((a) => a.id === analysisId);
  if (i < 0) return <p className="text-sm text-muted">Esta análise foi removida.</p>;
  const a = t.analyses[i];

  const set = (next: Analysis): void => onChange({ ...t, analyses: replaceAt(t.analyses, i, next) });
  const setVisual = (v: Visual): void => onChange({ ...t, visuals: t.visuals.map((x) => (x.id === v.id ? v : x)) });
  const addVisual = (): void => {
    const v = defaultVisual("kpi", uniqueId("grafico", t.visuals.map((x) => x.id)), "");
    onChange({ ...t, visuals: [...t.visuals, v], analyses: replaceAt(t.analyses, i, { ...a, visuals: [...a.visuals, v.id] }) });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <TextInput value={a.title} onChange={(title) => set({ ...a, title })} placeholder="A força da vitória" />
      </Field>
      <Field label="O que a análise mostra">
        <TextArea value={a.description} rows={2} onChange={(description) => set({ ...a, description })} />
      </Field>
      <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${a.hidden ? "border-accent/50 bg-accent/10" : "border-line"}`}>
        <input type="checkbox" checked={a.hidden} onChange={(e) => set({ ...a, hidden: e.target.checked })} className="mt-0.5" />
        <span>
          <span className="font-medium">Ocultar do sumário (fora do ar)</span>
          <span className="block text-xs text-muted">
            Some do sumário e da página para quem vê o dashboard, até você desmarcar. A pré-visualização continua mostrando.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Gráficos</p>
        {a.visuals.map((id, vi) => {
          const v = t.visuals.find((x) => x.id === id);
          if (!v) return null;
          return (
            <ItemCard
              key={id}
              index={vi}
              count={a.visuals.length}
              title={visualTitle(v)}
              onMove={(to) => set({ ...a, visuals: moveAt(a.visuals, vi, to) })}
              onRemove={() => onChange(removeVisual(t, id))}
              removeLabel={`Remover o gráfico ${v.title}`}
            >
              <VisualEditor visual={v} template={t} onChange={setVisual} />
            </ItemCard>
          );
        })}
        <AddButton onClick={addVisual}>Adicionar gráfico nesta análise</AddButton>
      </div>

      <button
        type="button"
        onClick={() => {
          onChange(removeAnalysis(t, a.id));
          onRemoved();
        }}
        className="self-start text-xs text-muted hover:text-danger"
      >
        Remover esta análise
      </button>
    </div>
  );
}
