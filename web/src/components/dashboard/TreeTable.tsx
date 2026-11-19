"use client";

import { useMemo, useState } from "react";
import { formatValue } from "@/lib/format";
import type { TreeVisual, ValueFormat } from "@/lib/templates/schema";
import { allGroups, buildTree, initialOpen, visibleRows } from "./tree-rows";

export interface TreeColumn {
  measure: string;
  label: string;
  format: ValueFormat;
  balance: boolean;
}

interface TreeTableProps {
  visual: TreeVisual;
  rows: readonly Readonly<Record<string, unknown>>[];
  /** The visual's columns with their titles and formats (plain data: this part runs in the browser). */
  columns: readonly TreeColumn[];
}

/** A value of a line: a balance with its side (D/C), anything else as it is; zero as a dash. */
function cell(value: number, column: TreeColumn): string {
  if (Math.abs(value) < 0.005) return "—";
  if (!column.balance) return formatValue(value, column.format);
  return `${formatValue(Math.abs(value), column.format)} ${value > 0 ? "D" : "C"}`;
}

const INDENT_REM = 1.1;

/**
 * A tree that opens line by line, every group with the sum of what is under it (a trial balance). A search
 * finds an account and opens what is above it; the last line is the grand total — in a trial balance, the
 * balances add up to zero when the books close.
 */
export function TreeTable({ visual, rows, columns }: TreeTableProps) {
  const tree = useMemo(() => buildTree(visual.levels, visual.columns.map((c) => c.measure), rows), [visual, rows]);
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(tree.roots, visual.open));
  const [search, setSearch] = useState("");
  const shown = visibleRows(tree.roots, open, search);

  const toggle = (key: string): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar conta ou grupo"
          aria-label="Procurar conta ou grupo"
          className="h-7 w-56 rounded-md border border-line bg-transparent px-2 text-xs placeholder:text-muted focus:outline focus:outline-1 focus:outline-brand"
        />
        <button type="button" onClick={() => setOpen(allGroups(tree.roots))} className="rounded-md border border-line px-2 py-1 text-muted hover:text-text">
          Abrir tudo
        </button>
        <button type="button" onClick={() => setOpen(new Set())} className="rounded-md border border-line px-2 py-1 text-muted hover:text-text">
          Recolher
        </button>
      </div>
      <div className="max-h-[34rem] overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 text-left font-semibold">Conta</th>
              {columns.map((c) => <th key={c.measure} className="whitespace-nowrap px-2.5 py-2 text-right font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ node, depth, open: isOpen, match }) => {
              const group = node.children.length > 0;
              return (
                <tr key={node.key} className={`border-b border-line/60 ${depth === 0 ? "bg-text/[0.04] font-semibold" : ""} ${match ? "bg-brand/10" : ""}`}>
                  <td className="max-w-[20rem] py-1.5 pr-3" style={{ paddingLeft: `${0.75 + depth * INDENT_REM}rem` }}>
                    {group ? (
                      <button
                        type="button" onClick={() => toggle(node.key)} aria-expanded={isOpen}
                        className={`flex w-full min-w-0 items-center gap-1.5 text-left ${depth > 0 ? "font-medium" : ""}`}
                      >
                        <span className={`inline-block w-3 shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
                        <span className="truncate" title={node.label}>{node.label}</span>
                      </button>
                    ) : (
                      <span className="block truncate pl-[1.125rem] text-text/90" title={node.label}>{node.label}</span>
                    )}
                  </td>
                  {columns.map((c, i) => (
                    <td key={c.measure} className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
                      {cell(node.values[i], c)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted">Nada encontrado para “{search}”.</td></tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 bg-card">
            <tr className="border-t-2 border-text/40 font-semibold">
              <td className="px-3 py-2">Total</td>
              {columns.map((c, i) => (
                <td key={c.measure} className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{cell(tree.total[i], c)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
