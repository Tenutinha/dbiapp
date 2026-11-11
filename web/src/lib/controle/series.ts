/** Shapes the "controle" evolution charts draw. Pure — used by the page (server) and its tests. */

export interface SeriesPoint {
  /** "aaaa-mm-dd" in the daily series, "aaaa-mm" in the monthly one. */
  period: string;
  salesCents: number;
  purchasesCents: number;
}

/** A point of a running total; null where there is nothing to draw yet. */
export interface RunningPoint {
  period: string;
  salesCents: number | null;
  purchasesCents: number | null;
}

/**
 * Where the lines of a month stop: today, or the last day that has an entry when that is later
 * (entries may be dated ahead).
 */
export function lastDrawnDay(days: readonly SeriesPoint[], today: string): string {
  const lastWithEntry = days.reduce((last, day) => (day.salesCents !== 0 || day.purchasesCents !== 0 ? day.period : last), "");
  return lastWithEntry > today ? lastWithEntry : today;
}

/**
 * Running totals of a month, day by day. Days after `lastDay` (see lastDrawnDay) come empty, so
 * the lines stop there instead of running flat to the end of the month.
 */
export function cumulative(days: readonly SeriesPoint[], lastDay: string): RunningPoint[] {
  let sales = 0;
  let purchases = 0;
  return days.map((day) => {
    if (day.period > lastDay) return { period: day.period, salesCents: null, purchasesCents: null };
    sales += day.salesCents;
    purchases += day.purchasesCents;
    return { period: day.period, salesCents: sales, purchasesCents: purchases };
  });
}
