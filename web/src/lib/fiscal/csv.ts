/**
 * Writes rows as CSV for the regular ingest (read as text, then cast to the contract's types).
 * Pure: returns the file content.
 */
import type { Cell, Row } from "./sped";

const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** One CSV line (with its line break); null becomes an empty cell. */
export function csvLine(cells: readonly Cell[]): string {
  let out = "";
  for (let i = 0; i < cells.length; i += 1) {
    if (i > 0) out += ",";
    const v = cells[i];
    if (v !== null) out += quote(v);
  }
  return `${out}\n`;
}

/** CSV with a header in `columns` order; null and missing values become empty cells. */
export function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = [csvLine(columns)];
  for (const r of rows) lines.push(csvLine(columns.map((c) => r[c] ?? null)));
  return lines.join("");
}
