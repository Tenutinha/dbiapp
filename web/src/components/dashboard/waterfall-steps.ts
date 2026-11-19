/**
 * The bars of a "waterfall" visual: a total stands on zero; a step starts where the bar before it ended and
 * goes up (it adds) or down (it takes away). Pure — Waterfall.tsx draws them.
 */
export interface WaterfallItem {
  measure: string;
  label: string;
  /** A subtotal (receita líquida, lucro bruto…): drawn from zero, and the steps after it start from it. */
  total?: boolean;
}

export interface WaterfallBar {
  label: string;
  start: number;
  end: number;
  value: number;
  kind: "total" | "up" | "down";
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function waterfallBars(items: readonly WaterfallItem[], row: Readonly<Record<string, unknown>> | undefined): WaterfallBar[] {
  let running = 0;
  return items.map((item) => {
    const value = num(row?.[item.measure]);
    if (item.total) {
      running = value;
      return { label: item.label, start: 0, end: value, value, kind: "total" };
    }
    const start = running;
    running += value;
    return { label: item.label, start, end: running, value, kind: value >= 0 ? "up" : "down" };
  });
}

/** What a step is of the first total (the share of the revenue each line takes or adds). */
export function shareOfFirst(bars: readonly WaterfallBar[], bar: WaterfallBar): number | null {
  const base = bars.find((b) => b.kind === "total")?.value ?? bars[0]?.value ?? 0;
  return base === 0 ? null : bar.value / base;
}
