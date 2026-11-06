"use client";

import { useActionState, useEffect, useState } from "react";
import {
  registerTemplateAction,
  updateTemplateAction,
  type TemplateFormState,
} from "@/app/plataforma/catalogo/actions";

const INITIAL: TemplateFormState = { ok: false, message: "" };
const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand";

interface Props {
  mode: "create" | "update";
  /** Template id (update mode). */
  id?: string;
  /** Current JSON shown for editing (update mode). */
  initialJson?: string;
}

/** Registers a new dashboard template, or replaces the definition of an existing one. */
export function TemplateJsonForm({ mode, id, initialJson = "" }: Props) {
  const action = mode === "create" ? registerTemplateAction : updateTemplateAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [json, setJson] = useState(initialJson);
  const [fileName, setFileName] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setJson(await file.text());
    e.target.value = ""; // the text goes in the textarea; nothing else to upload
  }

  // After a failed submit, show exactly what the server validated (the textarea stays editable).
  useEffect(() => {
    if (!state.ok && state.json !== undefined) setJson(state.json);
  }, [state]);

  return (
    <form action={formAction} className="card flex flex-col gap-3 p-5">
      <h2 className="font-semibold">{mode === "create" ? "Cadastrar dashboard" : "Atualizar definição"}</h2>
      <p className="text-xs text-muted">
        Envie o <code className="font-mono">template.json</code> do dashboard: tabelas e colunas que a organização vai subir,
        relacionamentos, medidas em SQL e os visuais.
        {mode === "update" && " Ao mudar algo, aumente o campo \"version\"."}
      </p>
      {id && <input type="hidden" name="id" value={id} />}
      <label className="btn btn-ghost cursor-pointer text-sm">
        {fileName ? `Arquivo: ${fileName}` : "Escolher template.json"}
        <input type="file" accept=".json,application/json" className="sr-only" onChange={onFile} />
      </label>
      <textarea
        name="json"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={mode === "create" ? 10 : 18}
        spellCheck={false}
        placeholder='{ "id": "financeiro-dre", "version": 1, "name": "DRE", … }'
        className={`${INPUT} font-mono text-xs`}
        aria-label="Conteúdo do template.json"
      />
      {mode === "create" && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status inicial
          <select name="status" defaultValue="draft" className={INPUT}>
            <option value="draft">Rascunho — só a plataforma vê</option>
            <option value="published">Publicado — organizações já podem ativar</option>
          </select>
        </label>
      )}
      {state.breaking && state.breaking.length > 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs text-accent">
          <ul className="list-disc pl-4">
            {state.breaking.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-text">
            <input type="checkbox" name="confirmBreaking" />
            Entendi, atualizar mesmo assim
          </label>
        </div>
      )}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Validando…" : mode === "create" ? "Validar e cadastrar" : "Validar e atualizar"}
      </button>
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>
          <p>{state.message}</p>
          {state.errors && (
            <ul className="mt-1 list-disc pl-4 font-mono">
              {state.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
