"use client";

import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { TEMPLATE_ORIGINS, type Template } from "@/lib/templates/schema";
import { Field, Select, StepIntro, TextArea, TextInput } from "./ui";

interface GeneralStepProps {
  template: Template;
  onChange: (t: Template) => void;
}

const ORIGIN_OPTIONS = TEMPLATE_ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABEL[o] }));

/** The form only edits: the id never changes, it is the key organizations' dashboards point to. */
export function GeneralStep({ template: t, onChange }: GeneralStepProps) {
  return (
    <div>
      <StepIntro title="Sobre o dashboard">O nome e a descrição aparecem na vitrine e no catálogo das organizações.</StepIntro>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2">
          <TextInput value={t.name} onChange={(name) => onChange({ ...t, name })} placeholder="Visão Executiva de Vendas" />
        </Field>
        <Field label="O que ele faz" className="sm:col-span-2" hint="Uma ou duas frases: que perguntas o dashboard responde.">
          <TextArea
            value={t.description}
            onChange={(description) => onChange({ ...t, description })}
            placeholder="Receita, margem, ticket médio e desempenho por canal, região e produto."
          />
        </Field>
        <Field label="Área" hint="Agrupa na vitrine: Comercial, Financeiro, Eleições…">
          <TextInput value={t.area} onChange={(area) => onChange({ ...t, area })} placeholder="Comercial" />
        </Field>
        <Field label="Origem">
          <Select
            value={t.origin}
            options={ORIGIN_OPTIONS}
            onChange={(origin) => onChange({ ...t, origin: origin as Template["origin"] })}
          />
        </Field>
        <Field label="Identificador" hint="Não muda depois de cadastrado.">
          <TextInput value={t.id} onChange={() => undefined} mono readOnly />
        </Field>
        <Field label="Versão" hint="Sobe sozinha ao salvar uma alteração.">
          <TextInput value={`v${t.version}`} onChange={() => undefined} readOnly />
        </Field>
      </div>
    </div>
  );
}
