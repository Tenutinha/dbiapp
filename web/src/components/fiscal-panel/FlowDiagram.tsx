"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FLOW_COLUMNS, flowPath, linkKey, type FiscalFlow, type FlowColumn, type FlowNode } from "@/lib/fiscal/flow";
import { formatBytes } from "@/lib/format";
import { count } from "./labels";

export interface FlowNumbers {
  files: number;
  sizeBytes: number;
  /** "mm/aaaa a mm/aaaa", when there are files. */
  period: string | null;
  companies: number;
  /** Files already broken into blocks (null: this kind is read whole). */
  read: number | null;
  /** Published tables: lines and size by name. */
  tables: Record<string, { rows: number; sizeBytes: number }>;
  published: boolean;
}

const COLUMN_TITLE: Record<FlowColumn, { step: string; title: string; where: string }> = {
  origem: { step: "Início", title: "Arquivos originais", where: "no armazenamento" },
  blocos: { step: "2", title: "Quebra em blocos", where: "uma parte por arquivo e bloco" },
  tabelas: { step: "3", title: "Tabelas finais", where: "a união das partes, publicada" },
  dashboard: { step: "Fim", title: "Seções do dashboard", where: "o que a pessoa vê" },
};

interface Curve {
  key: string;
  d: string;
}

/** What the numbers of the space add to a node's short line. */
function nodeDetail(node: FlowNode, numbers: FlowNumbers): string {
  if (node.column === "origem") {
    return [`${count(numbers.files)} arquivo(s)`, formatBytes(numbers.sizeBytes), numbers.period, `${count(numbers.companies)} empresa(s)`].filter(Boolean).join(" · ");
  }
  if (node.table) {
    const table = numbers.tables[node.table];
    return `${node.detail} · ${table ? `${count(table.rows)} linhas, ${formatBytes(table.sizeBytes)}` : numbers.published ? "sem dados publicados" : "nada publicado"}`;
  }
  return node.detail;
}

/**
 * The path of the data of one fiscal dashboard, from the original files to the sections people read: four
 * columns of boxes joined by lines. Choosing a box lights its whole path, back to the files and on to the
 * dashboard, and says in words what happens there.
 */
export function FlowDiagram({ flow, numbers }: { flow: FiscalFlow; numbers: FlowNumbers }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const canvas = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLButtonElement>());

  const active = hovered ?? chosen;
  const path = useMemo(() => (active ? flowPath(flow, active) : null), [flow, active]);
  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow]);

  const measure = useCallback((): void => {
    const root = canvas.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    if (origin.width === 0) return; // folded away: measured when it opens
    const next: Curve[] = [];
    for (const link of flow.links) {
      const from = boxes.current.get(link.from)?.getBoundingClientRect();
      const to = boxes.current.get(link.to)?.getBoundingClientRect();
      if (!from || !to) continue;
      const x1 = from.right - origin.left;
      const y1 = from.top + from.height / 2 - origin.top;
      const x2 = to.left - origin.left;
      const y2 = to.top + to.height / 2 - origin.top;
      const bend = (x2 - x1) / 2;
      next.push({ key: linkKey(link), d: `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}` });
    }
    setCurves(next);
    setSize({ width: origin.width, height: origin.height });
  }, [flow]);

  useLayoutEffect(() => {
    measure();
    const root = canvas.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const chosenNode = chosen ? byId.get(chosen) : undefined;
  const chosenPath = useMemo(() => (chosen ? flowPath(flow, chosen) : null), [flow, chosen]);
  const namesIn = (column: FlowColumn): string[] =>
    flow.nodes.filter((n) => n.column === column && n.id !== chosen && chosenPath?.nodes.has(n.id)).map((n) => n.label);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Clique numa caixa para ver o caminho inteiro dela: de quais blocos e arquivos ela vem e quais tabelas e seções ela alimenta.
      </p>
      <div className="overflow-x-auto pb-1">
        <div ref={canvas} className="relative grid min-w-[780px] grid-cols-4 gap-x-10">
          <svg aria-hidden className="pointer-events-none absolute left-0 top-0" width={size.width} height={size.height}>
            {curves.map((c) => {
              const lit = path?.links.has(c.key) ?? false;
              return (
                <path
                  key={c.key}
                  d={c.d}
                  fill="none"
                  stroke={lit ? "var(--color-brand-2)" : "currentColor"}
                  strokeWidth={lit ? 2 : 1}
                  className="text-muted"
                  opacity={lit ? 0.95 : path ? 0.08 : 0.28}
                />
              );
            })}
          </svg>
          {FLOW_COLUMNS.map((column) => {
            const head = COLUMN_TITLE[column];
            const nodes = flow.nodes.filter((n) => n.column === column);
            return (
              <div key={column} className="relative flex min-w-0 flex-col gap-1.5">
                <div className="mb-1">
                  <p className="text-xs uppercase tracking-wide text-muted">{head.step}</p>
                  <p className="text-sm font-semibold">{head.title}</p>
                  <p className="text-xs text-muted">{head.where}{column === "blocos" && numbers.read !== null ? ` · ${count(numbers.read)} de ${count(numbers.files)} arquivos lidos` : ""}</p>
                </div>
                {nodes.map((node, i) => {
                  const lit = path?.nodes.has(node.id) ?? false;
                  const newGroup = node.group !== undefined && node.group !== nodes[i - 1]?.group;
                  return (
                    <div key={node.id} className="flex flex-col gap-1.5">
                      {newGroup && <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">{node.group}</p>}
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) boxes.current.set(node.id, el);
                          else boxes.current.delete(node.id);
                        }}
                        aria-pressed={chosen === node.id}
                        onClick={() => setChosen((now) => (now === node.id ? null : node.id))}
                        onMouseEnter={() => setHovered(node.id)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(node.id)}
                        onBlur={() => setHovered(null)}
                        className={`flex min-w-0 flex-col rounded-md border bg-card px-2.5 py-1.5 text-left transition-opacity ${
                          chosen === node.id ? "border-brand-2 ring-1 ring-brand-2" : lit ? "border-brand-2" : "border-line"
                        } ${path && !lit ? "opacity-40" : ""}`}
                      >
                        <span className={`truncate text-xs font-semibold ${node.table ? "font-mono" : ""}`} title={node.label}>{node.label}</span>
                        <span className="truncate text-[11px] text-muted" title={nodeDetail(node, numbers)}>{nodeDetail(node, numbers)}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-md border border-line p-3 text-sm" aria-live="polite">
        {chosenNode ? (
          <div className="flex flex-col gap-2">
            <p>
              <span className={`font-semibold ${chosenNode.table ? "font-mono" : ""}`}>{chosenNode.label}</span>{" "}
              <span className="text-xs text-muted">{nodeDetail(chosenNode, numbers)}</span>
            </p>
            {chosenNode.notes.length > 0 && (
              <ul className="list-disc pl-5">
                {chosenNode.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              {([["blocos", "Blocos no caminho"], ["tabelas", "Tabelas no caminho"], ["dashboard", "Seções no caminho"]] as const).map(([column, label]) => {
                const names = namesIn(column);
                return names.length === 0 ? null : (
                  <div key={column} className="contents">
                    <dt className="text-muted">{label} ({count(names.length)})</dt>
                    <dd className={column === "tabelas" ? "font-mono" : ""}>{names.join(", ")}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ) : (
          <p className="text-muted">Nenhuma caixa escolhida. O diagrama é montado a partir do molde do dashboard: quando o molde muda, ele muda junto.</p>
        )}
      </div>
    </div>
  );
}
