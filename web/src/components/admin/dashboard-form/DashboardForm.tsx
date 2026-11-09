"use client";

import { useState, useTransition } from "react";
import {
  registerTemplateAction,
  updateTemplateAction,
  type TemplateFormState,
} from "@/app/plataforma/catalogo/actions";
import { emptyTemplate, prepareForSave } from "@/lib/templates/draft";
import { templateSchema, type Template } from "@/lib/templates/schema";
import { AnalysesStep } from "./AnalysesStep";
import { FilesStep } from "./FilesStep";
import { GeneralStep, type InitialStatus } from "./GeneralStep";
import { ModelStep } from "./ModelStep";
import { SummaryStep } from "./SummaryStep";

const STEPS = ["Geral", "Arquivos", "Campos e medidas", "Análises", "Sumário"] as const;

/** Which step an error path ("tables.0.name", "visuals.3"…) belongs to. */
function stepOfError(error: string): number {
  if (error.startsWith("Geral:")) return 0;
  if (error.startsWith("Arquivos:")) return 1;
  if (error.startsWith("Campos e medidas:")) return 2;
  if (error.startsWith("Análises:")) return 3;
  const root = error.split(/[.:]/)[0];
  if (root === "tables" || root === "relationships") return 1;
  if (root === "fields" || root === "measures" || root === "filters" || root === "filterDefaults") return 2;
  if (root === "visuals" || root === "analyses" || /visual|analysis \w/.test(error)) return 3;
  if (root === "summary" || error.includes("summary")) return 4;
  if (/relationship|dimension|fact table|sortBy|\.key/.test(error)) return 1;
  if (/field|measure|filter/.test(error)) return 2;
  return 0;
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
  /** Stored version when editing; null to register a new dashboard. */
  stored: Template | null;
  /** Organizations already using it (editing): contract changes then need confirmation. */
  usage?: number;
  /** Shipped in web/templates: a file with a higher version there replaces these edits. */
  builtIn?: boolean;
  onSaved: (message: string) => void;
}

export function DashboardForm({ stored, usage = 0, builtIn = false, onSaved }: DashboardFormProps) {
  const editing = stored !== null;
  const [template, setTemplate] = useState<Template>(() => stored ?? emptyTemplate());
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<InitialStatus>("draft");
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
    if (editing) data.set("id", toSave.id);
    else data.set("status", status);
    if (confirmBreaking) data.set("confirmBreaking", "on");
    startSaving(async () => {
      const action = editing ? updateTemplateAction : registerTemplateAction;
      const res = await action({ ok: false, message: "" }, data);
      setResult(res);
      if (res.ok) onSaved(res.message);
      else if (res.errors?.length) setStep(stepOfError(res.errors[0]));
    });
  };

  const stepProps = { template, onChange: setTemplate };

  return (
    <div className="card flex max-h-[calc(100vh-2rem)] flex-col">
      <header className="border-b border-line px-5 pb-3 pt-5 pr-12">
        <h2 className="font-semibold">{editing ? `Editar: ${stored.name}` : "Cadastrar dashboard"}</h2>
        {editing && usage > 0 && (
          <p className="mt-0.5 text-xs text-muted">Em uso em {usage} dashboard(s) de organizações. Mudanças nos arquivos pedem confirmação.</p>
        )}
        {builtIn && (
          <p className="mt-0.5 text-xs text-accent">
            Dashboard embutido (web/templates/{stored?.id}): se o arquivo no código ganhar uma versão maior que a salva aqui, ele substitui estas edições.
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
        {step === 0 && <GeneralStep {...stepProps} editing={editing} status={status} onStatus={setStatus} />}
        {step === 1 && <FilesStep {...stepProps} />}
        {step === 2 && <ModelStep {...stepProps} />}
        {step === 3 && <AnalysesStep {...stepProps} />}
        {step === 4 && <SummaryStep {...stepProps} />}
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
              {saving ? "Salvando…" : editing ? "Salvar alterações" : "Cadastrar"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
