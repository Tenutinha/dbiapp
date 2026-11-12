"use client";

import { useState, useTransition } from "react";
import { updateTemplateAction, type TemplateFormState } from "@/app/plataforma/catalogo/actions";
import { prepareForSave } from "@/lib/templates/draft";
import { templateSchema, type Template } from "@/lib/templates/schema";
import { GeneralStep } from "./GeneralStep";
import { StructureStep } from "./StructureStep";

/** Geral, then everything else in one table (summary → files, analyses, fields), like the admin. */
const STEPS = ["Geral", "Estrutura"] as const;

/** Which tab an error belongs to: "Geral" (name, text, area, id) or the structure table (everything else). */
function stepOfError(error: string): number {
  if (error.startsWith("Geral:")) return 0;
  const root = error.split(/[.:]/)[0];
  return ["id", "name", "description", "area", "origin", "version"].includes(root) ? 0 : 1;
}

/** Plain-language messages for the most common problems; anything else keeps its technical text. */
const FRIENDLY: Record<string, string> = {
  id: "Geral: o identificador precisa de letras minúsculas, números ou hífen.",
  measures: "Campos e medidas: cadastre ao menos uma medida.",
  visuals: "Análises: cadastre ao menos um gráfico.",
  tables: "Arquivos: cadastre ao menos um arquivo.",
};

function localErrors(t: Template): string[] {
  const missing = [
    !t.name.trim() && "Geral: informe o nome do dashboard.",
    !t.description.trim() && "Geral: descreva o que o dashboard faz.",
    !t.area.trim() && "Geral: informe a área.",
  ].filter((m): m is string => Boolean(m));
  const r = templateSchema.safeParse(t);
  const issues = r.success
    ? []
    : r.error.issues.map((i) => {
        const path = i.path.join(".");
        return FRIENDLY[path] ?? (path ? `${path}: ${i.message}` : i.message);
      });
  return [...missing, ...issues].slice(0, 20);
}

interface DashboardFormProps {
  /** The stored dashboard being edited. New dashboards are not made here: an AI agent builds them (skill novo-dashboard). */
  stored: Template;
  /** Organizations already using it: contract changes then need confirmation. */
  usage?: number;
  /** Shipped in web/templates: a file with a higher version there replaces these edits. */
  builtIn?: boolean;
  onSaved: (message: string) => void;
  /** Height cap of the form panel (shorter when something sits above it, e.g. the vitrine modal tabs). */
  maxHeightClass?: string;
}

export function DashboardForm({
  stored, usage = 0, builtIn = false, onSaved, maxHeightClass = "max-h-[calc(100vh-2rem)]",
}: DashboardFormProps) {
  const [template, setTemplate] = useState<Template>(stored);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<TemplateFormState | null>(null);
  const [confirmBreaking, setConfirmBreaking] = useState(false);
  const [saving, startSaving] = useTransition();

  const errors = result?.errors ?? [];
  const errorsByStep = STEPS.map((_, i) => errors.filter((e) => stepOfError(e) === i).length);

  const save = (): void => {
    const toSave = prepareForSave(template, stored);
    const local = localErrors(toSave);
    if (local.length > 0) {
      setResult({ ok: false, message: "Revise os pontos abaixo antes de salvar:", errors: local });
      setStep(stepOfError(local[0]));
      return;
    }
    const data = new FormData();
    data.set("json", JSON.stringify(toSave));
    data.set("id", toSave.id);
    if (confirmBreaking) data.set("confirmBreaking", "on");
    startSaving(async () => {
      const res = await updateTemplateAction({ ok: false, message: "" }, data);
      setResult(res);
      if (res.ok) onSaved(res.message);
      else if (res.errors?.length) setStep(stepOfError(res.errors[0]));
    });
  };

  const stepProps = { template, onChange: setTemplate };

  return (
    <div className={`card flex flex-col ${maxHeightClass}`}>
      <header className="border-b border-line px-5 pb-3 pt-5 pr-12">
        <h2 className="font-semibold">Editar: {stored.name}</h2>
        {usage > 0 && (
          <p className="mt-0.5 text-xs text-muted">Em uso em {usage} dashboard(s) de organizações. Mudanças nos arquivos pedem confirmação.</p>
        )}
        {builtIn && (
          <p className="mt-0.5 text-xs text-accent">
            Dashboard embutido (web/templates/{stored.id}): se o arquivo no código ganhar uma versão maior que a salva aqui, ele substitui estas edições.
          </p>
        )}
        <nav aria-label="Etapas" className="mt-3 flex gap-1 overflow-x-auto">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                step === i ? "bg-brand/20 text-text" : "text-muted hover:bg-line/40 hover:text-text"
              }`}
            >
              <span className="mr-1 tabular-nums opacity-60">{i + 1}</span>
              {label}
              {errorsByStep[i] > 0 && <span className="ml-1.5 rounded bg-danger/20 px-1 text-danger">{errorsByStep[i]}</span>}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {step === 0 && <GeneralStep {...stepProps} />}
        {step === 1 && <StructureStep {...stepProps} />}
      </div>

      <footer className="flex flex-col gap-3 border-t border-line px-5 py-3">
        {result && !result.ok && (
          <div role="alert" className="max-h-32 overflow-y-auto text-xs text-danger">
            <p>{result.message}</p>
            {errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4 font-mono">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
        {result?.breaking && result.breaking.length > 0 && (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs text-accent">
            <ul className="list-disc pl-4">
              {result.breaking.map((b) => <li key={b}>{b}</li>)}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-text">
              <input type="checkbox" checked={confirmBreaking} onChange={(e) => setConfirmBreaking(e.target.checked)} />
              Entendi, as organizações vão precisar reenviar os dados
            </label>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Voltar
          </button>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(step + 1)}>
                Próximo →
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
