/**
 * The grid of a "matrix" visual: one line per value of a field, one column per value of another (the months),
 * a cell where the two meet in the data. Pure — MatrixMap.tsx draws it.
 */
import { monthsBetween } from "@/lib/fiscal/panel";

export interface MatrixCell {
  value: number | null;
  /** The value as the reader sees it. */
  text: string;
}

export interface MatrixGrid {
  rows: string[];
  columns: string[];
  /** By "<row>|<column>". */
  cells: Record<string, MatrixCell>;
  /** The biggest value, for the shade of each cell (0: none has a number). */
  max: number;
  /** The columns are months (aaaa-mm): the missing ones between the first and the last are there, empty. */
  monthly: boolean;
}

export const cellKey = (row: string, column: string): string => `${row}|${column}`;

const MONTH = /^\d{4}-\d{2}$/;

export function matrixGrid(points: readonly { row: string; column: string; value: number | null; text: string }[]): MatrixGrid {
  const rows = [...new Set(points.map((p) => p.row))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const found = [...new Set(points.map((p) => p.column))].sort();
  const monthly = found.length > 0 && found.every((c) => MONTH.test(c));
  const columns = monthly ? monthsBetween(found[0], found[found.length - 1]) : found;
  const cells: Record<string, MatrixCell> = {};
  let max = 0;
  for (const p of points) {
    cells[cellKey(p.row, p.column)] = { value: p.value, text: p.text };
    if (p.value !== null && p.value > max) max = p.value;
  }
  return { rows, columns, cells, max, monthly };
}

/** How strong a cell is drawn, from 0.35 (the smallest) to 1 (the biggest): every cell with data is seen. */
export function shade(value: number | null, max: number): number {
  if (value === null || max <= 0) return 1;
  return 0.35 + 0.65 * Math.max(0, Math.min(1, value / max));
}

/** A CNPJ reads better with its punctuation; anything else stays as it is. */
export function rowLabel(row: string): string {
  return /^\d{14}$/.test(row) ? `${row.slice(0, 2)}.${row.slice(2, 5)}.${row.slice(5, 8)}/${row.slice(8, 12)}-${row.slice(12)}` : row;
}

export const monthLabel = (period: string): string => (MONTH.test(period) ? `${period.slice(5, 7)}/${period.slice(0, 4)}` : period);
