/**
 * Data filter of a dashboard: rows of the fact table it keeps (or drops) before anything is shown —
 * e.g. only cargo = "Presidente". Set by the organization's staff in the data manager; every visual and
 * every on-screen filter option is computed over the filtered fact table. Pure: validation + SQL.
 */
import { z } from "zod";
import { quoteIdent } from "../ingest/contract";

export const FACT_FILTER_OPS = ["in", "not_in"] as const;
export type FactFilterOp = (typeof FACT_FILTER_OPS)[number];

export interface FactFilterRule {
  /** Column of the fact table (contract name). */
  column: string;
  /** in = keep only these values; not_in = drop these values (rows with no value are kept). */
  op: FactFilterOp;
  values: string[];
}

export type FactFilter = readonly FactFilterRule[];

/** How rows without a value in the column are listed and chosen ("keep/drop the empty ones"). */
export const EMPTY_VALUE = "(vazio)";

export const MAX_RULES = 10;
export const MAX_VALUES = 500;

const ruleSchema = z.object({
  column: z.string().max(80),
  op: z.enum(FACT_FILTER_OPS),
  values: z.array(z.string().max(200)).max(MAX_VALUES),
});

/**
 * Validates a stored or submitted filter against the fact table's columns. Anything malformed means
 * "no filter" (never an error on the viewing screen); unknown columns and empty rules are dropped.
 */
export function parseFactFilter(raw: unknown, factColumns: readonly string[]): FactFilterRule[] {
  const parsed = z.array(ruleSchema).max(MAX_RULES).safeParse(raw);
  if (!parsed.success) return [];
  const byColumn = new Map<string, FactFilterRule>();
  for (const r of parsed.data) {
    if (!factColumns.includes(r.column)) continue;
    const values = [...new Set(r.values.map((v) => v.trim()).filter(Boolean))];
    if (values.length === 0) continue;
    byColumn.delete(r.column);
    byColumn.set(r.column, { column: r.column, op: r.op, values });
  }
  return [...byColumn.values()];
}

/**
 * WHERE clause over the raw fact file. Columns were checked against the contract (parseFactFilter) and
 * are quoted anyway; values are always bound, appended to `params` ($n continues the existing numbering).
 */
export function factFilterSql(filter: FactFilter, params: string[]): string {
  const clauses = filter.map((r) => {
    const col = quoteIdent(r.column);
    const empty = r.values.includes(EMPTY_VALUE);
    const placeholders = r.values.filter((v) => v !== EMPTY_VALUE).map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    const list = placeholders.join(", ");
    if (r.op === "in") {
      // Keep the listed values (and the rows without a value, when "(vazio)" is listed).
      if (!placeholders.length) return `${col} IS NULL`;
      return empty ? `(CAST(${col} AS VARCHAR) IN (${list}) OR ${col} IS NULL)` : `CAST(${col} AS VARCHAR) IN (${list})`;
    }
    // Drop the listed values; rows without a value stay unless "(vazio)" is listed.
    if (!placeholders.length) return `${col} IS NOT NULL`;
    return empty
      ? `(${col} IS NOT NULL AND CAST(${col} AS VARCHAR) NOT IN (${list}))`
      : `(${col} IS NULL OR CAST(${col} AS VARCHAR) NOT IN (${list}))`;
  });
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}
