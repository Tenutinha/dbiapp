"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FactFilterOp, FactFilterRule } from "@/lib/query/fact-filter";

interface Envelope<T> { success: boolean; data?: T; error?: string }
interface State {
  filter: FactFilterRule[];
  columns: { name: string; type: string }[];
  totalRows: number | null;
  keptRows: number | null;
  factError?: string;
}
interface Values { column: string; values: { value: string; rows: number }[]; truncated: boolean }

async function call<T>(instanceId: string, body: object): Promise<Envelope<T>> {
  try {
    const res = await fetch(`/api/instances/${instanceId}/data-filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Envelope<T>;
  } catch {
    return { success: false, error: "Sem conexão com o servidor." };
  }
}

const fmt = (n: number): string => n.toLocaleString("pt-BR");
const OP_LABEL: Record<FactFilterOp, string> = { in: "manter só", not_in: "excluir" };

function Meter({ kept, total }: { kept: number; total: number }) {
  const pct = total ? Math.round((kept / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span><b className="tabular-nums">{fmt(kept)}</b> de {fmt(total)} linhas da tabela fato</span>
        <span className="tabular-nums text-muted">{pct.toLocaleString("pt-BR")}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface EditorProps {
  instanceId: string;
  columns: State["columns"];
  initial: FactFilterRule | null;
  onApply: (rule: FactFilterRule) => void;
  onCancel: () => void;
}

/** Builds one rule: column → its values (with row counts) → keep only / drop the checked ones. */
function RuleEditor({ instanceId, columns, initial, onApply, onCancel }: EditorProps) {
  const [column, setColumn] = useState(initial?.column ?? "");
  const [op, setOp] = useState<FactFilterOp>(initial?.op ?? "in");
  const [checked, setChecked] = useState<Set<string>>(new Set(initial?.values ?? []));
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!column) return;
    let alive = true;
    setValues(null);
    setError(null);
    void call<Values>(instanceId, { action: "values", column }).then((r) => {
      if (!alive) return;
      if (r.success && r.data) setValues(r.data);
      else setError(r.error ?? "Não foi possível ler os valores.");
    });
    return () => { alive = false; };
  }, [instanceId, column]);

  const shown = useMemo(
    () => (values?.values ?? []).filter((v) => v.value.toLowerCase().includes(search.trim().toLowerCase())),
    [values, search],
  );
  const toggle = (v: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });

  return (
    <div className="rounded-xl border border-brand/40 bg-brand/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          Coluna
          <select value={column} onChange={(e) => { setColumn(e.target.value); setChecked(new Set()); setSearch(""); }}
            className="rounded-lg border border-line bg-bg px-2 py-1 font-mono outline-none focus:border-brand">
            <option value="" disabled>escolha…</option>
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
          </select>
        </label>
        <div className="flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="O que fazer com os valores marcados">
          {(["in", "not_in"] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={op === o} onClick={() => setOp(o)}
              className={`px-2.5 py-1 ${op === o ? "bg-brand text-on-brand" : "text-muted hover:text-text"}`}>
              {o === "in" ? "Manter só os marcados" : "Excluir os marcados"}
            </button>
          ))}
        </div>
      </div>

      {column && (
        <div className="mt-3">
          {error && <p className="text-xs text-danger">{error}</p>}
          {!values && !error && <p className="animate-pulse text-xs text-muted">Lendo os valores de {column}…</p>}
          {values && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar valor…"
                  className="w-48 rounded-lg border border-line bg-bg px-2 py-1 outline-none focus:border-brand" />
                <button type="button" onClick={() => setChecked(new Set([...checked, ...shown.map((v) => v.value)]))} className="text-brand-2 hover:underline">marcar todos</button>
                <button type="button" onClick={() => setChecked(new Set())} className="text-muted hover:underline">limpar</button>
                <span className="text-muted">{checked.size} marcado(s){values.truncated ? " · mostrando os 300 mais frequentes" : ""}</span>
              </div>
              <ul className="grid max-h-56 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
                {shown.map((v) => (
                  <li key={v.value}>
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-text/5">
                      <span className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" checked={checked.has(v.value)} onChange={() => toggle(v.value)} className="accent-[var(--color-brand)]" />
                        <span className="truncate" title={v.value}>{v.value}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">{fmt(v.rows)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={!column || checked.size === 0} onClick={() => onApply({ column, op, values: [...checked] })} className="btn btn-primary px-3 py-1.5 text-xs">
          Usar esta regra
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-text">Cancelar</button>
      </div>
    </div>
  );
}

/**
 * "Filtro dos dados": rules on the fact table's columns that decide which rows the dashboard shows
 * (viewing screen, shared links and on-screen filter options). Files are never changed.
 */
interface DataFilterPanelProps {
  instanceId: string;
  canEdit: boolean;
  /** Told how many rules are saved (the connector lights the fact → filter wire). */
  onSavedRules?: (count: number) => void;
}

export function DataFilterPanel({ instanceId, canEdit, onSavedRules }: DataFilterPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const savedCount = state?.filter.length ?? 0;
  useEffect(() => {
    onSavedRules?.(savedCount);
  }, [savedCount, onSavedRules]);
  const [draft, setDraft] = useState<FactFilterRule[]>([]);
  const [preview, setPreview] = useState<{ totalRows: number; keptRows: number } | null>(null);
  const [editing, setEditing] = useState<FactFilterRule | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void call<State>(instanceId, { action: "load" }).then((r) => {
      if (r.success && r.data) {
        setState(r.data);
        setDraft(r.data.filter);
      } else setMessage({ ok: false, text: r.error ?? "Não foi possível carregar o filtro." });
    });
  }, [instanceId]);

  const dirty = state !== null && JSON.stringify(draft) !== JSON.stringify(state.filter);

  useEffect(() => {
    if (!state?.totalRows || !dirty) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void call<{ totalRows: number; keptRows: number }>(instanceId, { action: "preview", filter: draft }).then((r) => r.success && r.data && setPreview(r.data));
    }, 300);
    return () => clearTimeout(timer);
  }, [instanceId, draft, dirty, state?.totalRows]);

  async function save(): Promise<void> {
    setSaving(true);
    const r = await call<FactFilterRule[]>(instanceId, { action: "save", filter: draft });
    setSaving(false);
    if (!r.success || !r.data) {
      setMessage({ ok: false, text: r.error ?? "Não foi possível salvar." });
      return;
    }
    setState((s) => s && { ...s, filter: r.data!, keptRows: preview?.keptRows ?? s.keptRows });
    setDraft(r.data);
    setMessage({ ok: true, text: "Filtro salvo — o dashboard já mostra só esses dados." });
    router.refresh();
  }

  function apply(rule: FactFilterRule): void {
    setDraft((d) => [...d.filter((r) => r.column !== rule.column), rule]);
    setEditing(null);
    setMessage(null);
  }

  if (!state) {
    return <section className="card p-5 text-sm text-muted">{message ? <span className="text-danger">{message.text}</span> : "Carregando o filtro dos dados…"}</section>;
  }
  const kept = preview?.keptRows ?? state.keptRows;
  const used = new Set(draft.map((r) => r.column));

  return (
    <section className="card flex flex-col gap-4 p-5">
      <header>
        <h3 className="font-semibold">Filtro dos dados <span className="font-normal text-muted">· tabela fato</span></h3>
        <p className="text-xs text-muted">
          Escolha quais linhas o dashboard considera. Vale para a tela, para os links compartilhados e para as
          opções dos filtros. Os arquivos não são alterados — dá para mudar ou tirar o filtro quando quiser.
        </p>
      </header>

      {state.factError ? (
        <p className="text-xs text-danger">{state.factError}</p>
      ) : state.totalRows === null ? (
        <p className="text-xs text-muted">Engate ou suba a tabela fato para poder filtrar.</p>
      ) : (
        <Meter kept={kept ?? state.totalRows} total={preview?.totalRows ?? state.totalRows} />
      )}

      {draft.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {draft.map((r) => (
            <li key={r.column} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
              <code className="font-mono font-semibold">{r.column}</code>
              <span className={`rounded px-1.5 py-0.5 font-semibold ${r.op === "in" ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}>{OP_LABEL[r.op]}</span>
              <span className="min-w-0 flex-1 truncate" title={r.values.join(", ")}>
                {r.values.slice(0, 4).join(", ")}{r.values.length > 4 ? ` +${r.values.length - 4}` : ""}
              </span>
              {canEdit && (
                <>
                  <button type="button" onClick={() => setEditing(r)} className="text-brand-2 hover:underline">editar</button>
                  <button type="button" onClick={() => setDraft((d) => d.filter((x) => x.column !== r.column))} aria-label={`Tirar a regra de ${r.column}`} className="text-muted hover:text-danger">×</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && state.totalRows !== null && (editing ? (
        <RuleEditor
          key={editing === "new" ? "new" : editing.column}
          instanceId={instanceId}
          columns={editing === "new" ? state.columns.filter((c) => !used.has(c.name)) : state.columns}
          initial={editing === "new" ? null : editing}
          onApply={apply}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setEditing("new")} className="text-xs font-medium text-brand-2 hover:underline">+ Filtrar por uma coluna</button>
          {dirty && (
            <>
              <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary px-3 py-1.5 text-xs">
                {saving ? "Salvando…" : "Salvar filtro"}
              </button>
              <button type="button" onClick={() => { setDraft(state.filter); setMessage(null); }} className="text-xs text-muted hover:text-text">Descartar mudanças</button>
            </>
          )}
        </div>
      ))}

      {message && <p role="status" className={`text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
    </section>
  );
}
