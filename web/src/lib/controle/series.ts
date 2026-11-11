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
 * Running totals of a month, day by day. Days after `lastDay` (today, in the current month) come
 * empty, so the lines stop at today instead of running flat to the end of the month.
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
