"use client";

import { moveAt, removeAt, replaceAt, toSnakeId, uniqueId, usedIds } from "@/lib/templates/draft";
import type { Field as TemplateField, Measure, Template } from "@/lib/templates/schema";
import { AddButton, Chips, Field, ItemCard, Select, StepIntro, TextArea, TextInput } from "./ui";

interface StepProps {
  template: Template;
  onChange: (t: Template) => void;
}

const FORMAT_OPTIONS = [
  { value: "currency", label: "Moeda (R$)" },
  { value: "number", label: "Número com decimais" },
  { value: "integer", label: "Número inteiro" },
  { value: "percent", label: "Percentual" },
  { value: "text", label: "Texto" },
];

/** Label edits also rename the id, unless the id is already in use (visuals and filters point to it). */
const relabel = <T extends { id: string; label: string }>(item: T, label: string, locked: boolean, taken: string[]): T => {
  if (locked || (item.id !== "" && item.id !== toSnakeId(item.label))) return { ...item, label };
  return { ...item, label, id: uniqueId(toSnakeId(label), taken.filter((id) => id !== item.id)) };
};

export function ModelStep({ template: t, onChange }: StepProps) {
  const used = usedIds(t);
  const fieldIds = t.fields.map((f) => f.id);
  const measureIds = t.measures.map((m) => m.id);
  const setField = (i: number, f: TemplateField): void => onChange({ ...t, fields: replaceAt(t.fields, i, f) });
  const setMeasure = (i: number, m: Measure): void => onChange({ ...t, measures: replaceAt(t.measures, i, m) });
  const filterFields = t.fields.map((f) => ({ value: f.id, label: f.label || f.id }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <StepIntro title="Campos">
          Atributos para agrupar e filtrar (ano, região, produto…). O SQL usa as colunas dos arquivos, ex.: <code className="font-mono">dim_produto.categoria</code>.
        </StepIntro>
        {t.fields.map((f, i) => (
          <ItemCard
            key={i}
            index={i}
            count={t.fields.length}
            title={f.label || "(campo sem nome)"}
            onMove={(to) => onChange({ ...t, fields: moveAt(t.fields, i, to) })}
            onRemove={() => onChange({ ...t, fields: removeAt(t.fields, i), filters: t.filters.filter((x) => x !== f.id) })}
            removeLabel={`Remover o campo ${f.label}`}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <Field label="Nome">
                <TextInput value={f.label} onChange={(label) => setField(i, relabel(f, label, used.fields.has(f.id), fieldIds))} placeholder="Categoria" />
              </Field>
              <Field label="Identificador" hint={used.fields.has(f.id) ? "Em uso por gráficos ou filtros." : undefined}>
                <TextInput value={f.id} mono readOnly={used.fields.has(f.id)} onChange={(id) => setField(i, { ...f, id: toSnakeId(id) })} />
              </Field>
              <Field label="SQL" className="sm:col-span-2">
                <TextInput value={f.sql} mono onChange={(sql) => setField(i, { ...f, sql })} placeholder="dim_produto.categoria" />
              </Field>
            </div>
          </ItemCard>
        ))}
        <AddButton onClick={() => onChange({ ...t, fields: [...t.fields, { id: "", label: "", sql: "" }] })}>
          Adicionar campo
        </AddButton>
      </section>

      <section className="flex flex-col gap-3">
        <StepIntro title="Medidas">
          Os números do dashboard, como as medidas DAX/Qlik traduzidas para SQL, ex.: <code className="font-mono">SUM(fato_vendas.valor)</code>.
        </StepIntro>
        {t.measures.map((m, i) => (
          <ItemCard
            key={i}
            index={i}
            count={t.measures.length}
            title={m.label || "(medida sem nome)"}
            onMove={(to) => onChange({ ...t, measures: moveAt(t.measures, i, to) })}
            onRemove={() => onChange({ ...t, measures: removeAt(t.measures, i) })}
            removeLabel={`Remover a medida ${m.label}`}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome">
                <TextInput value={m.label} onChange={(label) => setMeasure(i, relabel(m, label, used.measures.has(m.id), measureIds))} placeholder="Receita" />
              </Field>
              <Field label="Identificador" hint={used.measures.has(m.id) ? "Em uso por gráficos." : undefined}>
                <TextInput value={m.id} mono readOnly={used.measures.has(m.id)} onChange={(id) => setMeasure(i, { ...m, id: toSnakeId(id) })} />
              </Field>
              <Field label="Formato">
                <Select value={m.format} options={FORMAT_OPTIONS} onChange={(format) => setMeasure(i, { ...m, format: format as Measure["format"] })} />
              </Field>
              <Field label="SQL" className="sm:col-span-3">
                <TextArea value={m.sql} mono rows={2} onChange={(sql) => setMeasure(i, { ...m, sql })} placeholder="SUM(fato_vendas.valor)" />
              </Field>
            </div>
          </ItemCard>
        ))}
        <AddButton
          onClick={() => onChange({ ...t, measures: [...t.measures, { id: "", label: "", sql: "", format: "number" }] })}
        >
          Adicionar medida
        </AddButton>
      </section>

      <section className="flex flex-col gap-3">
        <StepIntro title="Filtros">Campos que aparecem na barra de filtros do dashboard, na ordem escolhida.</StepIntro>
        <Chips
          selected={t.filters}
          options={filterFields}
          emptyText="Cadastre campos acima para usá-los como filtro."
          onChange={(filters) =>
            onChange({
              ...t,
              filters,
              filterDefaults: Object.fromEntries(Object.entries(t.filterDefaults).filter(([k]) => filters.includes(k))),
            })
          }
        />
        {t.filters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {t.filters.map((id) => (
              <Field key={id} label={`Valor fixo de "${t.fields.find((f) => f.id === id)?.label ?? id}"`} hint="Opcional: o filtro sempre tem um valor (ex.: uma eleição).">
                <TextInput
                  value={t.filterDefaults[id] ?? ""}
                  onChange={(v) => {
                    const rest = Object.fromEntries(Object.entries(t.filterDefaults).filter(([k]) => k !== id));
                    onChange({ ...t, filterDefaults: v ? { ...rest, [id]: v } : rest });
                  }}
                />
              </Field>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
