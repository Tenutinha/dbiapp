"use client";

import { useMemo, useState } from "react";
import { formatValue } from "@/lib/format";
import { MISSING_LABEL, STATEMENT_LINE } from "@/lib/query/labels";
import { buildStatement, openableKeys, visibleNodes, type StatementNode, type StatementPeriod } from "@/lib/statement/tree";
import type { StatementVisual, ValueFormat } from "@/lib/templates/schema";
import { StatementIcon } from "./StatementIcon";

interface StatementTableProps {
  visual: StatementVisual;
  rows: readonly Readonly<Record<string, unknown>>[];
  format: ValueFormat;
  /** Label of the base line, for the share column ("% Receita líquida"). */
  baseLabel?: string;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const share = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "2025-12" → "dez/2025"; anything else as it came. */
function periodLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]}/${m[1]}` : value;
}

/** A money value of the statement: negatives in parentheses, as statements are read. */
function money(value: number, format: ValueFormat): string {
  if (value === 0) return "—";
  const text = formatValue(Math.abs(value), format);
  return value < 0 ? `(${text})` : text;
}

function Toggle({ options, value, onChange, label }: {
  options: { id: string; label: string }[]; value: string; onChange: (id: string) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 ${value === o.id ? "bg-brand text-white" : "text-muted hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const rowTone = (node: StatementNode): string => {
  if (node.kind === "total") return "font-semibold";
  if (node.kind === "group") return "font-medium";
  return node.depth === 1 ? "font-medium text-text/85" : "font-normal text-text/80";
};

/** Background of every cell of a row, opaque so the label column stays readable while it sticks on the left. */
const cellTone = (node: StatementNode, last: boolean): string => {
  if (node.kind !== "total") return "bg-card";
  return last ? "bg-[color-mix(in_srgb,var(--color-brand)_16%,var(--color-card))] font-bold" : "bg-[color-mix(in_srgb,var(--color-brand)_6%,var(--color-card))]";
};

/** Hierarchical statement (e.g. an income statement): lines open down to the accounts, periods in columns. */
export function StatementTable({ visual, rows, format, baseLabel }: StatementTableProps) {
  const [period, setPeriod] = useState<StatementPeriod>("column");
  const [shares, setShares] = useState(visual.base !== undefined);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const statement = useMemo(
    () => buildStatement(visual, rows, { lineColumn: STATEMENT_LINE, missing: MISSING_LABEL, period }),
    [visual, rows, period],
  );
  const openable = useMemo(() => openableKeys(statement.lines), [statement]);
  const shown = visibleNodes(statement.lines, open);
  const lastTotal = [...statement.lines].reverse().find((l) => l.kind === "total")?.key;
  const withShares = shares && visual.base !== undefined;

  const toggle = (key: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        // Closing a line closes what was open under it too.
        for (const k of current) if (k === key || k.startsWith(`${key}\u0001`)) next.delete(k);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (statement.columns.length === 0) return <p className="py-6 text-sm text-muted">Sem lançamentos para os filtros escolhidos.</p>;

  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {visual.yearly && (
          <Toggle
            label="Períodos nas colunas" value={period} onChange={(id) => setPeriod(id as StatementPeriod)}
            options={[{ id: "column", label: "Mês" }, { id: "year", label: "Ano" }]}
          />
        )}
        {visual.base !== undefined && (
          <Toggle
            label="Percentuais" value={shares ? "on" : "off"} onChange={(id) => setShares(id === "on")}
            options={[{ id: "off", label: "Valores" }, { id: "on", label: `Valores e % ${baseLabel ?? ""}`.trim() }]}
          />
        )}
        <span className="flex-1" />
        <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setOpen(new Set(openable))}>Abrir tudo</button>
        <span aria-hidden className="text-xs text-line">|</span>
        <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setOpen(new Set())}>Fechar tudo</button>
      </div>
      <div tabIndex={0} role="region" aria-label="Demonstrativo com rolagem" className="-mx-1 max-h-[36rem] overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b border-line text-xs text-muted">
              <th className="sticky left-0 z-30 bg-card px-2 py-2 text-left font-medium">Linha</th>
              {statement.columns.map((c) => (
                <th key={c} colSpan={withShares ? 2 : 1} className="whitespace-nowrap px-2 py-2 text-right font-medium">
                  {c === "Total" ? "Total" : periodLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((node) => {
              const canOpen = node.children.length > 0;
              const isOpen = open.has(node.key);
              const tone = rowTone(node);
              const cell = cellTone(node, node.key === lastTotal);
              return (
                <tr key={node.key} className={`border-b border-line/40 ${node.kind === "total" ? "border-t border-t-line" : ""} ${tone}`}>
                  <th scope="row" className={`sticky left-0 z-10 px-2 py-1.5 text-left ${tone} ${cell}`}>
                    <div className="flex min-w-64 max-w-[28rem] items-center gap-1.5" style={{ paddingLeft: `${node.depth * 1.1}rem` }}>
                      {canOpen ? (
                        <button
                          type="button" onClick={() => toggle(node.key)} aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Fechar" : "Abrir"} ${node.label}`}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-text/10 hover:text-text"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </button>
                      ) : (
                        <span aria-hidden className="h-5 w-5 shrink-0" />
                      )}
                      {node.icon && (
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${node.kind === "total" ? "bg-brand text-white" : "bg-brand/10 text-brand"}`}>
                          <StatementIcon name={node.icon} className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <span className="truncate" title={node.label}>{node.label}</span>
                    </div>
                  </th>
                  {node.values.map((v, i) => {
                    const valueTone = node.kind === "total" ? (v < 0 ? "text-danger" : "text-ok") : v < 0 ? "text-text/70" : "";
                    const s = node.shares[i];
                    return [
                      <td key={`v${i}`} className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-xs tabular-nums ${cell} ${valueTone}`}>
                        {money(v, format)}
                      </td>,
                      withShares && (
                        <td key={`s${i}`} className={`whitespace-nowrap py-1.5 pl-1 pr-3 text-right font-mono text-[11px] tabular-nums text-muted ${cell}`}>
                          {s === null || v === 0 ? "" : share.format(s)}
                        </td>
                      ),
                    ];
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
