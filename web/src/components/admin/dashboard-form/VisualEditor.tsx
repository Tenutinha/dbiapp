"use client";

import { defaultVisual, type VisualType } from "@/lib/templates/draft";
import { MAP_GEOS, type MapVisual, type Template, type Visual } from "@/lib/templates/schema";
import { Checkbox, Chips, Field, NumberInput, Select, TextArea, TextInput, type Option } from "./ui";

export const VISUAL_TYPE_LABEL: Record<VisualType, string> = {
  kpi: "Indicador (número grande)",
  bar: "Barras",
  line: "Linha",
  donut: "Rosca",
  table: "Tabela",
  map: "Mapa",
  text: "Texto explicativo",
};
const TYPE_OPTIONS = (Object.keys(VISUAL_TYPE_LABEL) as VisualType[]).map((v) => ({ value: v, label: VISUAL_TYPE_LABEL[v] }));
const SPAN_OPTIONS = [
  { value: "3", label: "1/4 da largura" },
  { value: "4", label: "1/3 da largura" },
  { value: "6", label: "Metade" },
  { value: "8", label: "2/3 da largura" },
  { value: "12", label: "Largura toda" },
];
const GEO_LABEL: Record<MapVisual["geo"], string> = { uf: "Estados (UF)", municipio: "Municípios" };

interface VisualEditorProps {
  visual: Visual;
  template: Template;
  onChange: (v: Visual) => void;
}

export function VisualEditor({ visual: v, template: t, onChange }: VisualEditorProps) {
  const fields: Option[] = t.fields.map((f) => ({ value: f.id, label: f.label || f.id }));
  const measures: Option[] = t.measures.map((m) => ({ value: m.id, label: m.label || m.id }));
  const opts = { fields, measures };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Título" className="sm:col-span-3">
          <TextInput value={v.title} onChange={(title) => onChange({ ...v, title })} placeholder="Receita por mês" />
        </Field>
        <Field label="Tipo">
          <Select value={v.type} options={TYPE_OPTIONS} onChange={(type) => onChange(defaultVisual(type as VisualType, v.id, v.title))} />
        </Field>
        <Field label="Largura">
          <Select value={String(v.span)} options={SPAN_OPTIONS} onChange={(s) => onChange({ ...v, span: Number(s) })} />
        </Field>
      </div>
      <TypeSettings visual={v} onChange={onChange} {...opts} />
    </div>
  );
}

interface TypeSettingsProps {
  visual: Visual;
  onChange: (v: Visual) => void;
  fields: Option[];
  measures: Option[];
}

function TypeSettings({ visual: v, onChange, fields, measures }: TypeSettingsProps) {
  const noMeasures = "Cadastre medidas na etapa Campos e medidas.";
  const noFields = "Cadastre campos na etapa Campos e medidas.";
  switch (v.type) {
    case "kpi":
      return (
        <Field label="Medida">
          <Select value={v.measure} empty="— escolha" options={measures} onChange={(measure) => onChange({ ...v, measure })} />
        </Field>
      );
    case "bar":
    case "line":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Eixo (campo)">
            <Select value={v.field} empty="— escolha" options={fields} onChange={(field) => onChange({ ...v, field })} />
          </Field>
          <Field label="Ordem">
            <Select
              value={v.sort}
              options={[
                { value: "field", label: "Pelo campo" },
                { value: "measure_desc", label: "Maior valor primeiro" },
              ]}
              onChange={(sort) => onChange({ ...v, sort: sort as typeof v.sort })}
            />
          </Field>
          <Field label="Máximo de itens">
            <NumberInput value={v.limit} min={1} max={1000} onChange={(limit) => onChange({ ...v, limit })} />
          </Field>
          <Field label="Medidas" className="sm:col-span-3">
            <Chips selected={v.measures} options={measures} emptyText={noMeasures} onChange={(m) => onChange({ ...v, measures: m })} />
          </Field>
          {v.type === "bar" && <Checkbox checked={v.horizontal} onChange={(horizontal) => onChange({ ...v, horizontal })} label="Barras deitadas" />}
        </div>
      );
    case "donut":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fatias (campo)">
            <Select value={v.field} empty="— escolha" options={fields} onChange={(field) => onChange({ ...v, field })} />
          </Field>
          <Field label="Medida">
            <Select value={v.measure} empty="— escolha" options={measures} onChange={(measure) => onChange({ ...v, measure })} />
          </Field>
          <Field label="Máximo de fatias">
            <NumberInput value={v.limit} min={1} max={20} onChange={(limit) => onChange({ ...v, limit })} />
          </Field>
        </div>
      );
    case "table":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Colunas de campos" className="sm:col-span-2">
            <Chips selected={v.fields} options={fields} emptyText={noFields} onChange={(f) => onChange({ ...v, fields: f })} />
          </Field>
          <Field label="Colunas de medidas" className="sm:col-span-2">
            <Chips
              selected={v.measures}
              options={measures}
              emptyText={noMeasures}
              onChange={(m) => onChange({ ...v, measures: m, orderBy: v.orderBy && m.includes(v.orderBy) ? v.orderBy : undefined })}
            />
          </Field>
          <Field label="Ordenar por (maior primeiro)">
            <Select
              value={v.orderBy ?? ""}
              empty="A primeira medida"
              options={measures.filter((m) => v.measures.includes(m.value))}
              onChange={(o) => onChange({ ...v, orderBy: o || undefined })}
            />
          </Field>
          <Field label="Máximo de linhas">
            <NumberInput value={v.limit} min={1} max={1000} onChange={(limit) => onChange({ ...v, limit })} />
          </Field>
        </div>
      );
    case "map":
      return <MapSettings visual={v} onChange={onChange} fields={fields} measures={measures} />;
    case "text":
      return (
        <Field label="Texto" hint="Parágrafos separados por uma linha em branco.">
          <TextArea value={v.body} rows={5} onChange={(body) => onChange({ ...v, body })} />
        </Field>
      );
  }
}

interface MapSettingsProps {
  visual: MapVisual;
  onChange: (v: Visual) => void;
  fields: Option[];
  measures: Option[];
}

function MapSettings({ visual: v, onChange, fields, measures }: MapSettingsProps) {
  const color = v.color;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Mapa">
        <Select
          value={v.geo}
          options={MAP_GEOS.map((g) => ({ value: g, label: GEO_LABEL[g] }))}
          onChange={(geo) => onChange({ ...v, geo: geo as MapVisual["geo"] })}
        />
      </Field>
      <Field label="Código IBGE (campo)">
        <Select value={v.field} empty="— escolha" options={fields} onChange={(field) => onChange({ ...v, field })} />
      </Field>
      <Field label="Nome da área (campo)">
        <Select value={v.labelField ?? ""} empty="— nenhum" options={fields} onChange={(f) => onChange({ ...v, labelField: f || undefined })} />
      </Field>
      <Field label="Cor">
        <Select
          value={color.mode}
          options={[
            { value: "scale", label: "Escala de valores" },
            { value: "category", label: "Categoria (ex.: vencedor)" },
          ]}
          onChange={(mode) =>
            onChange({
              ...v,
              color:
                mode === "category"
                  ? { mode: "category", measure: color.measure, colorMeasure: "" }
                  : { mode: "scale", measure: color.measure, scheme: "sequential" },
            })
          }
        />
      </Field>
      <Field label={color.mode === "category" ? "Categoria (medida de texto)" : "Valor (medida)"}>
        <Select value={color.measure} empty="— escolha" options={measures} onChange={(measure) => onChange({ ...v, color: { ...color, measure } })} />
      </Field>
      {color.mode === "scale" ? (
        <Field label="Esquema">
          <Select
            value={color.scheme}
            options={[
              { value: "sequential", label: "Do claro ao escuro" },
              { value: "diverging", label: "Divergente (dois lados)" },
            ]}
            onChange={(scheme) => onChange({ ...v, color: { ...color, scheme: scheme as typeof color.scheme } })}
          />
        </Field>
      ) : (
        <>
          <Field label="Cor da categoria (medida #rrggbb)">
            <Select value={color.colorMeasure} empty="— escolha" options={measures} onChange={(colorMeasure) => onChange({ ...v, color: { ...color, colorMeasure } })} />
          </Field>
          <Field label="Intensidade 0–1 (opcional)">
            <Select
              value={color.strengthMeasure ?? ""}
              empty="— nenhuma"
              options={measures}
              onChange={(s) => onChange({ ...v, color: { ...color, strengthMeasure: s || undefined } })}
            />
          </Field>
        </>
      )}
      <Field label="Medidas no balão ao passar o mouse" className="sm:col-span-3">
        <Chips selected={v.tooltip} options={measures} onChange={(tooltip) => onChange({ ...v, tooltip })} />
      </Field>
    </div>
  );
}
