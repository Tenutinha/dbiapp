/** The periods of a network map's timeline: pure, unit-tested. */
import { toNumber, type NetworkRow } from "./network-graph";

export interface TimelinePeriod {
  key: string;
  /** Short label for the bar ("mar/26"). */
  label: string;
  /** Long label for the summary ("março de 2026"). */
  title: string;
  /** Sum of the measure in the period. */
  total: number;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-03" → mar/26 and "março de 2026"; anything else is shown as it is. */
export function periodLabels(key: string): { label: string; title: string } {
  const m = /^(\d{4})-(\d{2})/.exec(key);
  const month = m ? Number(m[2]) - 1 : -1;
  if (!m || month < 0 || month > 11) return { label: key, title: key };
  return { label: `${MONTHS[month]}/${m[1].slice(2)}`, title: `${MONTH_NAMES[month]} de ${m[1]}` };
}

/** The periods present in the rows, in order, each with its total of the measure. */
export function periodsOf(rows: readonly NetworkRow[], timeField: string, measure: string): TimelinePeriod[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row[timeField];
    if (key === null || key === undefined || key === "") continue;
    const k = String(key);
    totals.set(k, (totals.get(k) ?? 0) + Math.max(0, toNumber(row[measure]) ?? 0));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, total]) => ({ key, total, ...periodLabels(key) }));
}

/** The period after `current` while playing: the first one to start, none after the last. */
export function nextPeriod(periods: readonly TimelinePeriod[], current: string | null): string | null {
  if (periods.length === 0) return null;
  if (current === null) return periods[0].key;
  const i = periods.findIndex((p) => p.key === current);
  return i < 0 ? periods[0].key : periods[i + 1]?.key ?? null;
}
