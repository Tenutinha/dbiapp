"use client";

import { moveAt, removeAt, replaceAt } from "@/lib/templates/draft";
import type { SummaryGroup, Template } from "@/lib/templates/schema";
import { AddButton, Chips, Field, ItemCard, StepIntro, TextInput } from "./ui";

interface StepProps {
  template: Template;
  onChange: (t: Template) => void;
}

export function SummaryStep({ template: t, onChange }: StepProps) {
  const titleOf = (id: string): string => t.analyses.find((a) => a.id === id)?.title || "(análise sem título)";
  const setGroup = (i: number, g: SummaryGroup): void => onChange({ ...t, summary: replaceAt(t.summary, i, g) });
  const grouped = new Set(t.summary.flatMap((g) => g.analyses));
  const ungrouped = t.analyses.filter((a) => !grouped.has(a.id));

  if (t.analyses.length === 0) {
    return (
      <div>
        <StepIntro title="Sumário da sidebar">Agrupa as análises para navegar pela página.</StepIntro>
        <p className="text-sm text-muted">Cadastre as análises na etapa anterior para montar o sumário.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="flex flex-col gap-3">
        <StepIntro title="Sumário da sidebar">
          Organize as análises em grupos (ex.: “O resultado”, “Como o voto se moveu”). Ao abrir o dashboard, a sidebar mostra esse sumário e leva a cada seção.
        </StepIntro>
        {t.summary.map((g, i) => {
          // Each analysis belongs to one group: offer this group's own plus the ones still free.
          const options = t.analyses
            .filter((a) => g.analyses.includes(a.id) || !grouped.has(a.id))
            .map((a) => ({ value: a.id, label: a.title || "(sem título)" }));
          return (
            <ItemCard
              key={i}
              index={i}
              count={t.summary.length}
              title={g.title || "(grupo sem título)"}
              onMove={(to) => onChange({ ...t, summary: moveAt(t.summary, i, to) })}
              onRemove={() => onChange({ ...t, summary: removeAt(t.summary, i) })}
              removeLabel={`Remover o grupo ${g.title}`}
            >
              <Field label="Título do grupo">
                <TextInput value={g.title} onChange={(title) => setGroup(i, { ...g, title })} placeholder="O resultado" />
              </Field>
              <Field label="Análises do grupo, na ordem">
                <Chips selected={g.analyses} options={options} onChange={(analyses) => setGroup(i, { ...g, analyses })} />
              </Field>
            </ItemCard>
          );
        })}
        <AddButton onClick={() => onChange({ ...t, summary: [...t.summary, { title: "", analyses: [] }] })}>Adicionar grupo</AddButton>
        {ungrouped.length > 0 && (
          <p className="text-xs text-accent">
            Fora do sumário: {ungrouped.map((a) => a.title || "(sem título)").join(", ")}. Elas aparecem na página, mas não na sidebar.
          </p>
        )}
      </div>

      <aside aria-label="Prévia do sumário" className="h-fit rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Prévia na sidebar</p>
        <p className="mb-3 text-sm font-bold">{t.name || "Nome do dashboard"}</p>
        <SummaryPreview template={t} titleOf={titleOf} />
      </aside>
    </div>
  );
}

interface PreviewProps {
  template: Template;
  titleOf: (id: string) => string;
}

function SummaryPreview({ template: t, titleOf }: PreviewProps) {
  const groups = t.summary.filter((g) => g.analyses.length > 0);
  if (groups.length === 0) return <p className="text-xs text-muted">Nenhum grupo ainda.</p>;
  const numberOf = new Map(groups.flatMap((g) => g.analyses).map((id, i) => [id, i + 1]));
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => (
        <div key={i}>
          <p className="mb-1.5 text-xs text-muted">{g.title || "(grupo sem título)"}</p>
          <ul className="border-l border-line">
            {g.analyses.map((id) => (
              <li key={id} className="flex justify-between gap-2 py-0.5 pl-3 text-[13px]">
                <span className="truncate">{titleOf(id)}</span>
                <span className="tabular-nums text-muted">{numberOf.get(id)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
