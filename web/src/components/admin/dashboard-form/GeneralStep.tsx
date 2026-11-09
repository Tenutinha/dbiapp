"use client";

import { toKebabId } from "@/lib/templates/draft";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { TEMPLATE_ORIGINS, type Template } from "@/lib/templates/schema";
import { Field, Select, StepIntro, TextArea, TextInput } from "./ui";

export type InitialStatus = "draft" | "published";

interface GeneralStepProps {
  template: Template;
  onChange: (t: Template) => void;
  /** Editing keeps the id: it is the key organizations' dashboards point to. */
  editing: boolean;
  status: InitialStatus;
  onStatus: (s: InitialStatus) => void;
}

const ORIGIN_OPTIONS = TEMPLATE_ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABEL[o] }));

export function GeneralStep({ template: t, onChange, editing, status, onStatus }: GeneralStepProps) {
  const setName = (name: string): void => {
    // While creating, the address follows the name until the user edits it by hand.
    const followsName = !editing && (t.id === "" || t.id === toKebabId(t.name));
    onChange({ ...t, name, id: followsName ? toKebabId(name) : t.id });
  };

  return (
    <div>
      <StepIntro title="Sobre o dashboard">O nome e a descrição aparecem na vitrine e no catálogo das organizações.</StepIntro>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2">
          <TextInput value={t.name} onChange={setName} placeholder="Visão Executiva de Vendas" />
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
        <Field
          label="Identificador"
          hint={editing ? "Não muda depois de cadastrado." : "Gerado a partir do nome; letras minúsculas, números e hífen."}
        >
          <TextInput value={t.id} onChange={(id) => onChange({ ...t, id: toKebabId(id) || id.toLowerCase() })} mono readOnly={editing} />
        </Field>
        {editing ? (
          <Field label="Versão" hint="Sobe sozinha ao salvar uma alteração.">
            <TextInput value={`v${t.version}`} onChange={() => undefined} readOnly />
          </Field>
        ) : (
          <Field label="Status inicial">
            <Select
              value={status}
              options={[
                { value: "draft", label: "Rascunho — só a plataforma vê" },
                { value: "published", label: "Publicado — organizações já podem ativar" },
              ]}
              onChange={(s) => onStatus(s as InitialStatus)}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
