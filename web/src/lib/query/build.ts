/**
 * Turns template visuals into DuckDB SQL over the uploaded Parquet files.
 * Pure: no I/O, so it is unit-tested directly.
 *
 * Identifiers and expressions come from the (validated, trusted) template;
 * user-provided filter values are always bound as parameters.
 */
import type { Field, Measure, Template, Visual } from "../templates/schema";
import { quotePath } from "../duck/engine";

/** Selected values per filter field id. Empty / missing = no filter. */
export type FilterSelection = Readonly<Record<string, readonly string[]>>;

export interface BuiltQuery {
  sql: string;
  params: string[];
}

/** Physical file for each template table. */
export type TableFiles = Readonly<Record<string, string>>;

const MAX_FILTER_VALUES = 200;

function factTable(t: Template): string {
  const fact = t.tables.find((tb) => tb.kind === "fact");
  if (!fact) throw new Error(`template ${t.id} has no fact table`);
  return fact.name;
}

export function buildFrom(t: Template, files: TableFiles): string {
  const fileFor = (table: string): string => {
    const file = files[table];
    if (!file) throw new Error(`missing file for table ${table}`);
    return `read_parquet(${quotePath(file)})`;
  };
  const fact = factTable(t);
  const joins = t.relationships.map(
    (r) =>
      `LEFT JOIN ${fileFor(r.to.table)} AS ${r.to.table} ON ${r.from.table}.${r.from.column} = ${r.to.table}.${r.to.column}`,
  );
  return [`FROM ${fileFor(fact)} AS ${fact}`, ...joins].join("\n");
}

function lookup<T extends { id: string }>(items: readonly T[], id: string, kind: string): T {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown ${kind} ${id}`);
  return found;
}

export function buildWhere(t: Template, filters: FilterSelection, excludeField?: string): BuiltQuery {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const fieldId of t.filters) {
    if (fieldId === excludeField) continue;
    const values = (filters[fieldId] ?? []).slice(0, MAX_FILTER_VALUES);
    if (values.length === 0) continue;
    const field = lookup(t.fields, fieldId, "field");
    const placeholders = values.map((v) => {
      params.push(String(v));
      return `$${params.length}`;
    });
    clauses.push(`${fieldValue(field)} IN (${placeholders.join(", ")})`);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** Label shown for facts whose dimension row is missing (orphan keys / NULLs). */
export const MISSING_LABEL = "(sem cadastro)";

/** Same expression for charts, filter WHERE and filter options, so every shown value is filterable. */
function fieldValue(f: Field): string {
  return `COALESCE(CAST((${f.sql}) AS VARCHAR), '${MISSING_LABEL}')`;
}

const measureCol = (m: Measure): string => `${m.sql} AS ${m.id}`;
const fieldCol = (f: Field): string => `${fieldValue(f)} AS ${f.id}`;

function selectFor(t: Template, visual: Visual): { select: string[]; groupBy: string[]; tail: string } {
  const field = (id: string): Field => lookup(t.fields, id, "field");
  const measure = (id: string): Measure => lookup(t.measures, id, "measure");

  switch (visual.type) {
    case "kpi":
      return { select: [measureCol(measure(visual.measure))], groupBy: [], tail: "" };
    case "bar":
    case "line": {
      const f = field(visual.field);
      const order = visual.sort === "field" ? `${f.id} ASC` : `${visual.measures[0]} DESC NULLS LAST`;
      return {
        select: [fieldCol(f), ...visual.measures.map((m) => measureCol(measure(m)))],
        groupBy: ["1"],
        tail: `ORDER BY ${order} LIMIT ${visual.limit}`,
      };
    }
    case "donut": {
      const f = field(visual.field);
      return {
        select: [fieldCol(f), measureCol(measure(visual.measure))],
        groupBy: ["1"],
        tail: `ORDER BY ${visual.measure} DESC NULLS LAST LIMIT ${visual.limit}`,
      };
    }
    case "table": {
      const fs = visual.fields.map(field);
      return {
        select: [...fs.map(fieldCol), ...visual.measures.map((m) => measureCol(measure(m)))],
        groupBy: fs.map((_, i) => String(i + 1)),
        tail: `ORDER BY ${visual.measures[0]} DESC NULLS LAST LIMIT ${visual.limit}`,
      };
    }
  }
}

export function buildVisualQuery(t: Template, files: TableFiles, visual: Visual, filters: FilterSelection): BuiltQuery {
  const { select, groupBy, tail } = selectFor(t, visual);
  const where = buildWhere(t, filters);
  const sql = [
    `SELECT ${select.join(", ")}`,
    buildFrom(t, files),
    where.sql,
    groupBy.length ? `GROUP BY ${groupBy.join(", ")}` : "",
    tail,
  ]
    .filter(Boolean)
    .join("\n");
  return { sql, params: where.params };
}

/** Distinct values for a filter, honouring the *other* active filters (cross-filtering). */
export function buildFilterOptionsQuery(
  t: Template,
  files: TableFiles,
  fieldId: string,
  filters: FilterSelection,
): BuiltQuery {
  const field = lookup(t.fields, fieldId, "field");
  const where = buildWhere(t, filters, fieldId);
  const sql = [
    `SELECT DISTINCT ${fieldValue(field)} AS value`,
    buildFrom(t, files),
    where.sql,
    `ORDER BY value NULLS LAST LIMIT 500`,
  ]
    .filter(Boolean)
    .join("\n");
  return { sql, params: where.params };
}
