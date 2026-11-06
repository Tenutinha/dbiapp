"use client";

import { defaultVisual, moveAt, removeAnalysis, removeVisual, replaceAt, uniqueId } from "@/lib/templates/draft";
import type { Analysis, Template, Visual } from "@/lib/templates/schema";
import { AddButton, Field, ItemCard, Select, StepIntro, TextArea, TextInput } from "./ui";
import { VISUAL_TYPE_LABEL, VisualEditor } from "./VisualEditor";

interface StepProps {
  template: Template;
  onChange: (t: Template) => void;
}

const visualTitle = (v: Visual): string => `${v.title || "(sem título)"} · ${VISUAL_TYPE_LABEL[v.type]}`;

export function AnalysesStep({ template: t, onChange }: StepProps) {
  const placed = new Set(t.analyses.flatMap((a) => a.visuals));
  const loose = t.visuals.filter((v) => !placed.has(v.id));
  const analysisOptions = t.analyses.map((a) => ({ value: a.id, label: a.title || "(análise sem título)" }));

  const setAnalysis = (i: number, a: Analysis): void => onChange({ ...t, analyses: replaceAt(t.analyses, i, a) });
  const setVisual = (v: Visual): void => onChange({ ...t, visuals: t.visuals.map((x) => (x.id === v.id ? v : x)) });
  const newVisual = (): Visual =>
    defaultVisual("kpi", uniqueId("grafico", t.visuals.map((v) => v.id)), "");
  const addVisualTo = (i: number): void => {
    const v = newVisual();
    onChange({
      ...t,
      visuals: [...t.visuals, v],
      analyses: replaceAt(t.analyses, i, { ...t.analyses[i], visuals: [...t.analyses[i].visuals, v.id] }),
    });
  };
  const placeVisual = (visualId: string, analysisId: string): void =>
    onChange({
      ...t,
      analyses: t.analyses.map((a) => (a.id === analysisId ? { ...a, visuals: [...a.visuals, visualId] } : a)),
    });
  const addAnalysis = (): void =>
    onChange({
      ...t,
      analyses: [...t.analyses, { id: uniqueId("analise", t.analyses.map((a) => a.id)), title: "", description: "", visuals: [] }],
    });

  return (
    <div className="flex flex-col gap-4">
      <StepIntro title="Análises">
        Cada análise é uma seção da página do dashboard, com título, uma explicação e os seus gráficos, na ordem em que aparecem.
      </StepIntro>

      {t.analyses.map((a, i) => (
        <ItemCard
          key={a.id}
          index={i}
          count={t.analyses.length}
          title={`${i + 1}. ${a.title || "(análise sem título)"}`}
          onMove={(to) => onChange({ ...t, analyses: moveAt(t.analyses, i, to) })}
          onRemove={() => onChange(removeAnalysis(t, a.id))}
          removeLabel={`Remover a análise ${a.title}`}
        >
          <Field label="Título">
            <TextInput value={a.title} onChange={(title) => setAnalysis(i, { ...a, title })} placeholder="A força da vitória" />
          </Field>
          <Field label="O que a análise mostra">
            <TextArea value={a.description} rows={2} onChange={(description) => setAnalysis(i, { ...a, description })} />
          </Field>
          <div className="flex flex-col gap-2 border-l-2 border-line pl-3">
            {a.visuals.map((id, vi) => {
              const v = t.visuals.find((x) => x.id === id);
              if (!v) return null;
              return (
                <ItemCard
                  key={id}
                  index={vi}
                  count={a.visuals.length}
                  title={visualTitle(v)}
                  onMove={(to) => setAnalysis(i, { ...a, visuals: moveAt(a.visuals, vi, to) })}
                  onRemove={() => onChange(removeVisual(t, id))}
                  removeLabel={`Remover o gráfico ${v.title}`}
                >
                  <VisualEditor visual={v} template={t} onChange={setVisual} />
                </ItemCard>
              );
            })}
            <AddButton onClick={() => addVisualTo(i)}>Adicionar gráfico nesta análise</AddButton>
          </div>
        </ItemCard>
      ))}
      <AddButton onClick={addAnalysis}>Adicionar análise</AddButton>

      {loose.length > 0 && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
          <p className="text-sm font-semibold">Gráficos fora das análises</p>
          <p className="mb-3 text-xs text-muted">Aparecem no topo da página, antes da primeira análise. Mova-os para uma análise se quiser.</p>
          <div className="flex flex-col gap-2">
            {loose.map((v) => (
              <details key={v.id} className="rounded-lg border border-line bg-bg/40 p-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{visualTitle(v)}</span>
                  <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {analysisOptions.length > 0 && (
                      <span className="w-48">
                        <Select value="" empty="Mover para…" options={analysisOptions} ariaLabel={`Mover ${v.title}`} onChange={(aid) => aid && placeVisual(v.id, aid)} />
                      </span>
                    )}
                    <button type="button" className="rounded px-2 text-muted hover:text-danger" aria-label={`Remover o gráfico ${v.title}`} onClick={() => onChange(removeVisual(t, v.id))}>
                      ×
                    </button>
                  </span>
                </summary>
                <div className="mt-3">
                  <VisualEditor visual={v} template={t} onChange={setVisual} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
