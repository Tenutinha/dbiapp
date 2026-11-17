import { Fragment } from "react";
import { formatValue } from "@/lib/format";
import type { ValueFormat } from "@/lib/templates/schema";
import { scorecardLines, SPARK, sparkOf, type ScorecardLine, type ScorecardVisual, type Tone } from "./scorecard-lines";

const TONE: Record<Tone, string> = { ok: "text-ok", danger: "text-danger", neutral: "text-muted" };

/** A change in the measure's own unit: percentage points for a rate, the value itself otherwise. */
function changeText(change: number, format: ValueFormat): string {
  const sign = change > 0 ? "+" : "−";
  if (format === "percent") return `${sign}${(Math.abs(change) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
  return `${sign}${formatValue(Math.abs(change), format, true)}`;
}

function referenceText(line: ScorecardLine, format: ValueFormat): string {
  const { target, better } = line.item;
  if (target === undefined) return better === "higher" ? "positivo" : "—";
  return `${better === "higher" ? "≥ " : better === "lower" ? "≤ " : ""}${formatValue(target, format)}`;
}

function Sparkline({ line, label }: { line: ScorecardLine; label: string }) {
  const spark = sparkOf(line.series, line.item.target ?? (line.item.better ? 0 : undefined));
  if (!spark.last) return <span className="text-muted">—</span>;
  return (
    <svg width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} role="img" aria-label={label} className="block text-brand-2">
      {spark.guide !== null && <line x1={0} x2={SPARK.width} y1={spark.guide} y2={spark.guide} stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" opacity={0.45} className="text-muted" />}
      <path d={spark.path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={spark.last.x} cy={spark.last.y} r={2.2} fill="currentColor" />
    </svg>
  );
}

interface ScorecardProps {
  visual: ScorecardVisual;
  rows: readonly Record<string, unknown>[];
  /** Label and format of a measure, by its id. */
  measure: (id: string) => { label: string; format: ValueFormat };
}

/**
 * The table of indicators: for each one, the mini chart of its evolution first, then what it is, its latest
 * value, how it moved since the value before, the usual reference and where it stands against it. Every
 * indicator on the same plane, so one reads the business across them.
 */
export function Scorecard({ visual, rows, measure }: ScorecardProps) {
  const { periods, lines } = scorecardLines(visual, rows);
  const latest = periods.at(-1) ?? "";
  const first = periods[0] ?? "";
  const th = "px-2 py-2 font-medium";
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className={th}>Evolução{first && latest ? ` (${first} a ${latest})` : ""}</th>
            <th scope="col" className={th}>Indicador</th>
            <th scope="col" className={`${th} text-right`}>{latest || "Último"}</th>
            <th scope="col" className={`${th} text-right`}>Variação</th>
            <th scope="col" className={`${th} text-right`}>Referência</th>
            <th scope="col" className={th}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const m = measure(line.item.measure);
            const label = line.item.label ?? m.label;
            const opens = line.item.group !== undefined && line.item.group !== lines[i - 1]?.item.group;
            return (
              <Fragment key={line.item.measure}>
                {opens && (
                  <tr className="border-b border-line bg-text/5">
                    <th scope="colgroup" colSpan={6} className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide">{line.item.group}</th>
                  </tr>
                )}
                <tr className="border-b border-line/50 last:border-0">
                  <td className="px-2 py-1.5"><Sparkline line={line} label={`Evolução de ${label}`} /></td>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    <span className="font-medium">{label}</span>
                    {line.item.note && <span className="block text-xs text-muted">{line.item.note}</span>}
                  </th>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{formatValue(line.current, m.format, true)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${TONE[line.changeTone]}`}>
                    {line.change === null ? "—" : line.change === 0 ? "igual" : changeText(line.change, m.format)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted">{referenceText(line, m.format)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 ${line.status ? TONE[line.status.tone] : "text-muted"}`}>
                    {line.status ? (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span aria-hidden className="inline-block size-2 rounded-full bg-current" />
                        {line.status.label}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
