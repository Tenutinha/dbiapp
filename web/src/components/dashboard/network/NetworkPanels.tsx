"use client";

import { formatValue } from "@/lib/format";
import { throughput, type NetworkEdge, type NetworkGraph, type NetworkNode } from "@/lib/network-graph";
import type { ValueFormat } from "@/lib/templates/schema";
import { css, type Rgb } from "./colors";

export interface PanelMeasure {
  id: string;
  label: string;
  format: ValueFormat;
}

const PANEL = "rounded-xl border border-line/70 bg-card/85 shadow-xl backdrop-blur-md";

/** Plural of a kind of place for the counts line ("Filial" → "filiais"), good enough for pt-BR names. */
export function pluralKind(kind: string, n: number): string {
  const k = kind.toLowerCase();
  if (n === 1) return k;
  // "Centro de distribuição" → "centros de distribuição": only the first word takes the plural.
  const space = k.indexOf(" ");
  if (space > 0) return `${pluralKind(k.slice(0, space), n)}${k.slice(space)}`;
  if (/[^aeiou]l$/.test(k) || k.endsWith("al") || k.endsWith("el") || k.endsWith("ol") || k.endsWith("ul")) return k.replace(/l$/, "is");
  if (k.endsWith("il")) return k.replace(/il$/, "is");
  if (k.endsWith("ão")) return k.replace(/ão$/, "ões");
  if (/[rsz]$/.test(k)) return `${k}es`;
  if (/[aeiou]$/.test(k)) return `${k}s`;
  return k;
}

interface SummaryProps {
  graph: NetworkGraph;
  kindColor: ReadonlyMap<string, Rgb>;
  measure: PanelMeasure;
  title: string;
}

/** Top left: what the map holds (places per kind, relationships, the total moved). */
export function NetworkSummary({ graph, kindColor, measure, title }: SummaryProps) {
  const counts = graph.kinds.map((k) => [k, graph.nodes.filter((n) => n.kind === k).length] as const);
  const total = graph.edges.reduce((sum, e) => sum + e.value, 0);
  return (
    <div className={`${PANEL} pointer-events-auto max-w-[min(22rem,calc(100%-2rem))] px-4 py-3`}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{formatValue(total, measure.format, true)}</p>
      <p className="text-xs text-muted">{measure.label.toLowerCase()} em {graph.edges.length.toLocaleString("pt-BR")} relações</p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {counts.map(([kind, n]) => (
          <li key={kind} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: css(kindColor.get(kind) ?? [128, 128, 128]) }} aria-hidden />
            <b className="tabular-nums">{n}</b> {pluralKind(kind, n)}
          </li>
        ))}
      </ul>
      {graph.skipped > 0 && <p className="mt-2 text-[11px] text-accent">{graph.skipped} relações sem coordenadas ficaram fora do mapa.</p>}
    </div>
  );
}

interface LegendProps {
  kinds: readonly string[];
  categories: readonly string[];
  kindColor: ReadonlyMap<string, Rgb>;
  categoryColor: ReadonlyMap<string, Rgb>;
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export const kindKey = (k: string): string => `k:${k}`;
export const categoryKey = (c: string): string => `c:${c}`;

/** Bottom left: the colours, each one a switch that hides or shows its places or arcs. */
export function NetworkLegend({ kinds, categories, kindColor, categoryColor, hidden, onToggle }: LegendProps) {
  const item = (key: string, label: string, color: Rgb, shape: "dot" | "line") => {
    const off = hidden.has(key);
    return (
      <li key={key}>
        <button
          type="button" onClick={() => onToggle(key)} aria-pressed={!off}
          className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-text/10 ${off ? "opacity-40" : ""}`}
          title={off ? "Mostrar" : "Esconder"}
        >
          <span
            className={shape === "dot" ? "size-2.5 shrink-0 rounded-sm" : "h-1 w-4 shrink-0 rounded-full"}
            style={{ background: css(color) }} aria-hidden
          />
          <span className={off ? "line-through" : ""}>{label}</span>
        </button>
      </li>
    );
  };
  return (
    <div className={`${PANEL} pointer-events-auto max-h-[45%] overflow-y-auto px-2.5 py-2`}>
      <p className="px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Locais</p>
      <ul>{kinds.map((k) => item(kindKey(k), k, kindColor.get(k) ?? [128, 128, 128], "dot"))}</ul>
      {categories.length > 0 && (
        <>
          <p className="mt-1.5 px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Relações</p>
          <ul>{categories.map((c) => item(categoryKey(c), c, categoryColor.get(c) ?? [128, 128, 128], "line"))}</ul>
        </>
      )}
    </div>
  );
}

interface TooltipProps {
  x: number;
  y: number;
  width: number;
  height: number;
  children: React.ReactNode;
}

/** Follows the pointer, flipped to the other side near the edges so it never leaves the map. */
export function NetworkTooltip({ x, y, width, height, children }: TooltipProps) {
  const left = x > width - 300 ? x - 16 : x + 16;
  const top = y > height - 220 ? y - 12 : y + 12;
  return (
    <div
      role="tooltip"
      className={`${PANEL} pointer-events-none absolute z-20 w-max max-w-72 px-3 py-2 text-xs`}
      style={{ left, top, transform: `translate(${x > width - 300 ? "-100%" : "0"}, ${y > height - 220 ? "-100%" : "0"})` }}
    >
      {children}
    </div>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <p className="flex justify-between gap-4"><span className="text-muted">{label}</span><b className="tabular-nums">{value}</b></p>
);

export function NodeTip({ node, measure, color }: { node: NetworkNode; measure: PanelMeasure; color: Rgb }) {
  const fmt = (v: number): string => formatValue(v, measure.format);
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="size-2.5 rounded-sm" style={{ background: css(color) }} aria-hidden />{node.label}
      </p>
      <p className="mb-1.5 text-muted">{[node.kind, node.detail].filter(Boolean).join(" · ")}</p>
      {node.out > 0 && <Line label={`${measure.label} enviado`} value={fmt(node.out)} />}
      {node.in > 0 && <Line label={`${measure.label} recebido`} value={fmt(node.in)} />}
      <Line label="Relaciona-se com" value={`${node.partners.length} ${node.partners.length === 1 ? "local" : "locais"}`} />
      {node.partners.length > 0 && (
        <p className="mt-1.5 text-muted">Principais: {node.partners.slice(0, 3).map((p) => p.label).join(", ")}</p>
      )}
      <p className="mt-1.5 text-[11px] text-muted">Clique para ver os detalhes</p>
    </>
  );
}

interface EdgeTipProps {
  edge: NetworkEdge;
  from: NetworkNode | undefined;
  to: NetworkNode | undefined;
  measures: readonly PanelMeasure[];
  color: Rgb;
}

export function EdgeTip({ edge, from, to, measures, color }: EdgeTipProps) {
  return (
    <>
      <p className="text-sm font-semibold">{from?.label ?? edge.source} → {to?.label ?? edge.target}</p>
      {edge.category && (
        <p className="mb-1.5 flex items-center gap-1.5 text-muted">
          <span className="h-1 w-3 rounded-full" style={{ background: css(color) }} aria-hidden />{edge.category}
        </p>
      )}
      {measures.map((m) => <Line key={m.id} label={m.label} value={formatValue(edge.row[m.id], m.format)} />)}
    </>
  );
}

interface DetailProps {
  node: NetworkNode;
  graph: NetworkGraph;
  measure: PanelMeasure;
  color: Rgb;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Right side, while a place is picked: everything it moves and the places it relates to. */
export function NodeDetail({ node, graph, measure, color, onPick, onClose }: DetailProps) {
  const fmt = (v: number): string => formatValue(v, measure.format);
  const share = (v: number): number => (throughput(node) > 0 ? v / Math.max(...node.partners.map((p) => p.value)) : 0);
  const byCategory = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.source !== node.id && e.target !== node.id) continue;
    const c = e.category ?? "Relações";
    byCategory.set(c, (byCategory.get(c) ?? 0) + e.value);
  }
  return (
    <aside className={`${PANEL} pointer-events-auto flex max-h-full w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden`} aria-label={`Detalhes de ${node.label}`}>
      <div className="flex items-start justify-between gap-2 border-b border-line/70 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: css(color) }} aria-hidden />{node.kind}
          </p>
          <h3 className="truncate text-base font-semibold" title={node.label}>{node.label}</h3>
          {node.detail && <p className="text-xs text-muted">{node.detail}</p>}
        </div>
        <button type="button" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-text/10 hover:text-text" aria-label="Fechar detalhes">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-line/70 px-4 py-3 text-xs">
        <div><p className="text-muted">Enviado</p><p className="text-base font-bold tabular-nums">{fmt(node.out)}</p></div>
        <div><p className="text-muted">Recebido</p><p className="text-base font-bold tabular-nums">{fmt(node.in)}</p></div>
        {[...byCategory.entries()].map(([c, v]) => (
          <div key={c}><p className="truncate text-muted" title={c}>{c}</p><p className="font-semibold tabular-nums">{fmt(v)}</p></div>
        ))}
      </div>
      <p className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted">Relaciona-se com {node.partners.length} {node.partners.length === 1 ? "local" : "locais"}</p>
      <ul className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {node.partners.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-text/10">
              <span className="flex justify-between gap-3"><span className="truncate">{p.label}</span><b className="tabular-nums">{fmt(p.value)}</b></span>
              <span className="mt-1 block h-1 rounded-full bg-text/10">
                <span className="block h-1 rounded-full" style={{ width: `${Math.max(2, share(p.value) * 100)}%`, background: css(color) }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
