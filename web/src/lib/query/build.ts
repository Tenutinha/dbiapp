/**
 * Turns template visuals into DuckDB SQL over the uploaded Parquet files.
 * Pure: no I/O, so it is unit-tested directly.
 *
 * Identifiers and expressions come from the (validated, trusted) template;
 * user-provided filter values are always bound as parameters.
 */
import type { Field, Measure, Template, Visual } from "../templates/schema";
import { quotePath } from "../duck/engine";
import { factFilterSql, type FactFilter } from "./fact-filter";

/** Selected values per filter field id. Empty / missing = no filter. */
export type FilterSelection = Readonly<Record<string, readonly string[]>>;

export interface BuiltQuery {
  sql: string;
  params: string[];
}

/** Physical file for each template table. */
export type TableFiles = Readonly<Record<string, string>>;

const MAX_FILTER_VALUES = 200;
/** Enough rows for every Brazilian municipality (5 570) plus the "Exterior" pseudo-area. */
const MAX_MAP_AREAS = 6000;

/** Visuals that run a query (static text does not). */
export type QueryVisual = Exclude<Visual, { type: "text" }>;

function factTable(t: Template): string {
  const fact = t.tables.find((tb) => tb.kind === "fact");
  if (!fact) throw new Error(`template ${t.id} has no fact table`);
  return fact.name;
}

/**
 * FROM + joins. With a dashboard data filter, the fact table is read through it (a sub-select keeping
 * the same alias), so every measure, join and filter option only sees the kept rows. Filter values are
 * appended to `params`.
 */
export function buildFrom(t: Template, files: TableFiles, factFilter: FactFilter = [], params: string[] = []): string {
  const fileFor = (table: string): string => {
    const file = files[table];
    if (!file) throw new Error(`missing file for table ${table}`);
    return `read_parquet(${quotePath(file)})`;
  };
  const fact = factTable(t);
  const where = factFilterSql(factFilter, params);
  const factSource = where ? `(SELECT * FROM ${fileFor(fact)} ${where})` : fileFor(fact);
  const joins = t.relationships.map(
    (r) =>
      `LEFT JOIN ${fileFor(r.to.table)} AS ${r.to.table} ON ${r.from.table}.${r.from.column} = ${r.to.table}.${r.to.column}`,
  );
  return [`FROM ${factSource} AS ${fact}`, ...joins].join("\n");
}

function lookup<T extends { id: string }>(items: readonly T[], id: string, kind: string): T {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown ${kind} ${id}`);
  return found;
}

/** WHERE of the on-screen filters; `params` may already hold values ($n continues after them). */
export function buildWhere(t: Template, filters: FilterSelection, excludeField?: string, params: string[] = []): BuiltQuery {
  const clauses: string[] = [];
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

function mapMeasures(visual: Extract<Visual, { type: "map" }>): string[] {
  const c = visual.color;
  const ids = c.mode === "category"
    ? [c.measure, c.colorMeasure, ...(c.strengthMeasure ? [c.strengthMeasure] : [])]
    : [c.measure];
  return [...new Set([...ids, ...visual.tooltip])];
}

function selectFor(t: Template, visual: QueryVisual): { select: string[]; groupBy: string[]; tail: string } {
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
        tail: `ORDER BY ${visual.orderBy ?? visual.measures[0]} DESC NULLS LAST LIMIT ${visual.limit}`,
      };
    }
    case "map": {
      const fs = [field(visual.field), ...(visual.labelField ? [field(visual.labelField)] : [])];
      return {
        select: [...fs.map(fieldCol), ...mapMeasures(visual).map((m) => measureCol(measure(m)))],
        groupBy: fs.map((_, i) => String(i + 1)),
        tail: `LIMIT ${MAX_MAP_AREAS}`,
      };
    }
  }
}

export function buildVisualQuery(
  t: Template, files: TableFiles, visual: QueryVisual, filters: FilterSelection, factFilter: FactFilter = [],
): BuiltQuery {
  const { select, groupBy, tail } = selectFor(t, visual);
  const params: string[] = [];
  const from = buildFrom(t, files, factFilter, params);
  const where = buildWhere(t, filters, undefined, params);
  const sql = [
    `SELECT ${select.join(", ")}`,
    from,
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
  factFilter: FactFilter = [],
): BuiltQuery {
  const field = lookup(t.fields, fieldId, "field");
  const params: string[] = [];
  const from = buildFrom(t, files, factFilter, params);
  const where = buildWhere(t, filters, fieldId, params);
  const sql = [
    `SELECT DISTINCT ${fieldValue(field)} AS value`,
    from,
    where.sql,
    `ORDER BY value NULLS LAST LIMIT 500`,
  ]
    .filter(Boolean)
    .join("\n");
  return { sql, params: where.params };
}
