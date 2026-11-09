/**
 * Column-by-column comparison of a file's schema with a contract table, for the data connector's
 * "does this file fit this table?" check. Pure; the real conversion still runs on ingest.
 */
import type { ColumnType, TemplateTable } from "../templates/schema";
import { matchColumns, normalizeName, type SourceColumn } from "./contract";

export type ColumnStatus = "ok" | "convert" | "missing" | "optional";

export interface ColumnCheck {
  name: string;
  type: ColumnType;
  required: boolean;
  /** Column of the file that feeds it (original header), or null. */
  source: string | null;
  sourceType: string | null;
  /** ok = same kind of type; convert = will be converted on engage; missing = required and absent. */
  status: ColumnStatus;
}

export interface SchemaCheck {
  /** False when the file cannot feed the table (a required column is missing, duplicated headers…). */
  ok: boolean;
  columns: ColumnCheck[];
  /** File columns that are not in the contract (ignored on engage). */
  extras: string[];
  errors: string[];
  warnings: string[];
}

/** Which contract type a DuckDB type naturally is. */
function familyOf(duckType: string): ColumnType | null {
  const t = duckType.toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|INT\d*)$/.test(t)) return "integer";
  if (/^(DOUBLE|FLOAT|REAL|DECIMAL)/.test(t)) return "decimal";
  if (/^(VARCHAR|TEXT|STRING)/.test(t)) return "text";
  if (t === "DATE") return "date";
  if (t.startsWith("TIMESTAMP")) return "timestamp";
  if (t === "BOOLEAN") return "boolean";
  return null;
}

export function checkSchema(table: TemplateTable, source: readonly SourceColumn[]): SchemaCheck {
  const match = matchColumns(table, source);
  const byName = new Map(source.map((c) => [c.name, c]));
  const expected = new Set(table.columns.map((c) => c.name));

  const columns = table.columns.map((col): ColumnCheck => {
    const mapped = match.mapping.find((m) => m.target === col.name)?.source ?? null;
    const sourceType = mapped ? (byName.get(mapped)?.type ?? null) : null;
    const status: ColumnStatus = mapped === null
      ? (col.required ? "missing" : "optional")
      : familyOf(sourceType ?? "") === col.type ? "ok" : "convert";
    return { name: col.name, type: col.type, required: col.required, source: mapped, sourceType, status };
  });

  return {
    ok: match.errors.length === 0,
    columns,
    extras: source.filter((c) => !expected.has(normalizeName(c.name))).map((c) => c.name),
    errors: match.errors,
    warnings: match.warnings,
  };
}
