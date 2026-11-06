/**
 * Colour helpers for choropleth maps. Pure, so they are unit-tested directly.
 */

const HEX = /^#([0-9a-f]{6})$/i;

/** Parses #rrggbb; anything else returns null (colours come from uploaded data). */
export function parseHex(color: unknown): [number, number, number] | null {
  const m = typeof color === "string" ? HEX.exec(color.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** Mixes `color` towards `base`: weight 1 = color, 0 = base. Invalid colours fall back to `fallback`. */
export function mix(color: unknown, base: string, weight: number, fallback = "#8d97ad"): string {
  const c = parseHex(color) ?? parseHex(fallback)!;
  const b = parseHex(base) ?? [128, 128, 128];
  const w = Math.min(1, Math.max(0, weight));
  return toHex(c.map((v, i) => v * w + b[i] * (1 - w)));
}

/** Lightest weight a weak area gets, so every area stays readable as its category. */
export const MIN_STRENGTH_WEIGHT = 0.35;

/**
 * Maps strength values to weights in [MIN_STRENGTH_WEIGHT, 1], linearly between the 5th and 95th
 * percentiles so a few extreme areas do not wash out the rest. Missing values get full weight.
 */
export function strengthWeights(values: readonly (number | null)[]): number[] {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return values.map(() => 1);
  const at = (q: number): number => finite[Math.min(finite.length - 1, Math.floor(q * (finite.length - 1)))];
  const lo = at(0.05);
  const hi = at(0.95);
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return 1;
    if (hi <= lo) return 1;
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    return MIN_STRENGTH_WEIGHT + t * (1 - MIN_STRENGTH_WEIGHT);
  });
}

export interface LegendItem {
  label: string;
  color: string;
  count: number;
}

/** Categories present on the map, most frequent first (one colour per label: the first seen). */
export function categoryLegend(rows: readonly { label: string; color: string }[], max = 8): LegendItem[] {
  const byLabel = new Map<string, LegendItem>();
  for (const r of rows) {
    const item = byLabel.get(r.label);
    if (item) item.count += 1;
    else byLabel.set(r.label, { label: r.label, color: r.color, count: 1 });
  }
  return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")).slice(0, max);
}

/** Range for a continuous scale: 2nd–98th percentile; diverging scales are symmetric around zero. */
export function scaleRange(values: readonly number[], diverging: boolean): { min: number; max: number } {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { min: 0, max: 1 };
  const at = (q: number): number => sorted[Math.round(q * (sorted.length - 1))];
  const min = at(0.02);
  const max = at(0.98);
  if (diverging) {
    const m = Math.max(Math.abs(min), Math.abs(max)) || 1;
    return { min: -m, max: m };
  }
  return max > min ? { min, max } : { min, max: min + 1 };
}
