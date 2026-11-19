/**
 * The table of indicators (visual "scorecard"): one line per measure, each with its evolution along a field
 * (the months), its latest value, how it moved and where it stands against its reference. Pure — Scorecard.tsx
 * draws what this works out.
 */
import type { Visual } from "@/lib/templates/schema";

export type ScorecardVisual = Extract<Visual, { type: "scorecard" }>;
export type ScorecardItem = ScorecardVisual["items"][number];

export type Tone = "ok" | "danger" | "neutral";

export interface ScorecardLine {
  item: ScorecardItem;
  /** The values along the field, the oldest first (null where the measure has none). */
  series: (number | null)[];
  current: number | null;
  /** The value before the latest, and the change from it. */
  previous: number | null;
  change: number | null;
  /** Whether that change is good, by the side the indicator is better on. */
  changeTone: Tone;
  status: { label: string; tone: Tone } | null;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Where a value stands: against the reference when the indicator has one, else by its sign when higher is better. */
export function statusOf(item: ScorecardItem, current: number | null): ScorecardLine["status"] {
  if (current === null) return null;
  const good = (isGood: boolean): Tone => (item.better === undefined ? "neutral" : isGood ? "ok" : "danger");
  if (item.target !== undefined) {
    if (current === item.target) return { label: "Na referência", tone: item.better === undefined ? "neutral" : "ok" };
    const above = current > item.target;
    return { label: above ? "Acima da referência" : "Abaixo da referência", tone: good(above === (item.better === "higher")) };
  }
  // Without a reference, the sign only says something of what is better higher (a result: profit or loss).
  if (item.better !== "higher" || current === 0) return null;
  const positive = current > 0;
  return { label: positive ? "Positivo" : "Negativo", tone: good(positive === (item.better === "higher")) };
}

/**
 * The lines of the table. `rows` come as the query gives them — one per value of the field, the latest first —
 * with each measure under its id.
 */
export function scorecardLines(visual: ScorecardVisual, rows: readonly Record<string, unknown>[]): { periods: string[]; lines: ScorecardLine[] } {
  const ordered = [...rows].reverse();
  const periods = ordered.map((r) => String(r[visual.field] ?? ""));
  const lines = visual.items.map((item): ScorecardLine => {
    const series = ordered.map((r) => num(r[item.measure]));
    const current = series.at(-1) ?? null;
    const previous = series.length > 1 ? series.at(-2) ?? null : null;
    const change = current !== null && previous !== null ? current - previous : null;
    const changeTone: Tone = change === null || change === 0 || item.better === undefined ? "neutral" : (change > 0) === (item.better === "higher") ? "ok" : "danger";
    return { item, series, current, previous, change, changeTone, status: statusOf(item, current) };
  });
  return { periods, lines };
}

export const SPARK = { width: 132, height: 30, pad: 3 } as const;

export interface Spark {
  /** The line, in SVG path syntax (a gap where the measure has no value). */
  path: string;
  /** The latest point. */
  last: { x: number; y: number } | null;
  /** Height of the reference (or of zero), when it falls inside what the line covers. */
  guide: number | null;
}

/** The mini chart of a series, scaled to its own range (so every indicator shows its shape, whatever its size). */
export function sparkOf(series: readonly (number | null)[], guideAt: number | undefined): Spark {
  const values = series.filter((v): v is number => v !== null);
  if (values.length === 0) return { path: "", last: null, guide: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const { width, height, pad } = SPARK;
  const x = (i: number): number => (series.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (series.length - 1));
  const y = (v: number): number => (max === min ? height / 2 : height - pad - ((v - min) * (height - 2 * pad)) / span);
  let path = "";
  let pen = false;
  let last: Spark["last"] = null;
  series.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
    last = { x: x(i), y: y(v) };
  });
  const guide = guideAt !== undefined && max !== min && guideAt >= min && guideAt <= max ? y(guideAt) : null;
  return { path, last, guide };
}
