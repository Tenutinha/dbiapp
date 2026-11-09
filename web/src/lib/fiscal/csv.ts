/**
 * Writes rows as CSV for the regular ingest (read as text, then cast to the contract's types).
 * Pure: returns the file content.
 */
import type { Row } from "./sped";

const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV with a header in `columns` order; null and missing values become empty cells. */
export function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = [columns.map(quote).join(",")];
  for (const r of rows) lines.push(columns.map((c) => quote(r[c] ?? "")).join(","));
  return `${lines.join("\n")}\n`;
}
