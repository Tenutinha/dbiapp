/**
 * Turns template visuals into DuckDB SQL over the uploaded Parquet files.
 * Pure: no I/O, so it is unit-tested directly.
 *
 * Identifiers and expressions come from the (validated, trusted) template;
 * user-provided filter values are always bound as parameters.
 */
import { mainFact, type Field, type Measure, type Template, type Visual } from "../templates/schema";
import { readParquet } from "../duck/engine";
import { joinParts, splitParts } from "../storage-parts";
import type { CrossSelection } from "./cross";
import { factFilterSql, type FactFilter } from "./fact-filter";

/** Selected values per filter field id. Empty / missing = no filter. */
export type FilterSelection = Readonly<Record<string, readonly string[]>>;

export interface BuiltQuery {
  sql: string;
  params: string[];
}

/** Physical file for each template table (several parts in one path when the table came from several files). */
export type TableFiles = Readonly<Record<string, string>>;

const MAX_FILTER_VALUES = 200;
/** Enough rows for every Brazilian municipality (5 570) plus the "Exterior" pseudo-area. */
const MAX_MAP_AREAS = 6000;

/** Visuals that run a query (static text does not). */
export type QueryVisual = Exclude<Visual, { type: "text" }>;

/** A fact table as a query reads it: its file, and the name it goes by in the SQL (its own, or its `sameAs`). */
export interface FactSource {
  table: string;
  alias: string;
}

/** The fact has no file in this version (an extra fact not loaded yet): its visuals are simply empty. */
export class MissingFactError extends Error {}

export function factSource(t: Template, name?: string): FactSource {
  const table = name === undefined ? mainFact(t) : t.tables.find((tb) => tb.kind === "fact" && tb.name === name);
  if (!table) throw new Error(`template ${t.id} has no fact table ${name}`);
  return { table: table.name, alias: table.sameAs ?? table.name };
}

/** Every fact of the template, the main one first. */
export function factSources(t: Template): FactSource[] {
  return t.tables.filter((tb) => tb.kind === "fact").map((tb) => factSource(t, tb.name));
}

const mentions = (sql: string, table: string): boolean => new RegExp(`\\b${table}\\.`).test(sql);

/**
 * The relationships a fact reaches, in template order: the ones that start at it (by the name it is read
 * under) and, snowflake, the ones that start at a dimension already reached.
 */
function reachOf(t: Template, alias: string): Template["relationships"] {
  const reached = new Set([alias]);
  return t.relationships.filter((r) => {
    if (!reached.has(r.from.table)) return false;
    reached.add(r.to.table);
    return true;
  });
}

/** The columns an expression reads, as "table.column" (tables of the template only), each one once. */
function columnsOf(t: Template, sql: string): string[] {
  const found = new Set<string>();
  for (const tb of t.tables) {
    for (const m of sql.matchAll(new RegExp(`\\b${tb.name}\\.([a-z_][a-z0-9_]*)\\b`, "g"))) {
      if (tb.columns.some((c) => c.name === m[1])) found.add(`${tb.name}.${m[1]}`);
    }
  }
  return [...found];
}

/** Whether an expression only mentions tables a fact reaches: the fact itself (by its alias) and its dimensions. */
function inScope(t: Template, alias: string, sql: string): boolean {
  const reach = new Set([alias, ...reachOf(t, alias).map((r) => r.to.table)]);
  return t.tables.every((tb) => reach.has(tb.name) || !mentions(sql, tb.name));
}

/**
 * FROM + joins. With a dashboard data filter, the fact table is read through it (a sub-select keeping
 * the same alias), so every measure, join and filter option only sees the kept rows. Filter values are
 * appended to `params`.
 */
export function buildFrom(
  t: Template, files: TableFiles, factFilter: FactFilter = [], params: string[] = [],
  /** Which dimensions the query uses; the others are not joined (a LEFT JOIN on a unique key changes nothing). */
  uses: (table: string) => boolean = () => true,
  /** The fact this query reads (default: the main one). */
  source: FactSource = factSource(t),
): string {
  const fileFor = (table: string): string => {
    const file = files[table];
    if (!file) throw new Error(`missing file for table ${table}`);
    return readParquet(file);
  };
  const main = mainFact(t).name;
  if (!files[source.table] && source.table !== main) throw new MissingFactError(source.table);
  // The data filter is written on the main fact's columns: it holds for every fact read under that name.
  const where = source.alias === main ? factFilterSql(factFilter, params) : "";
  const factSql = where ? `(SELECT * FROM ${fileFor(source.table)} ${where})` : fileFor(source.table);
  const relationships = reachOf(t, source.alias);
  // Every table must have its file, used by this query or not: a dashboard is published whole.
  for (const r of relationships) fileFor(r.to.table);
  // A used dimension reached through another one (fact → candidato → partido) needs that one joined too.
  const needed = new Set(relationships.filter((r) => uses(r.to.table)).map((r) => r.to.table));
  for (let grew = true; grew;) {
    grew = false;
    for (const r of relationships) {
      if (needed.has(r.to.table) && r.from.table !== source.alias && !needed.has(r.from.table)) {
        needed.add(r.from.table);
        grew = true;
      }
    }
  }
  const joins = relationships.filter((r) => needed.has(r.to.table)).map(
    (r) =>
      `LEFT JOIN ${fileFor(r.to.table)} AS ${r.to.table} ON ${r.from.table}.${r.from.column} = ${r.to.table}.${r.to.column}`,
  );
  return [`FROM ${factSql} AS ${source.alias}`, ...joins].join("\n");
}

function lookup<T extends { id: string }>(items: readonly T[], id: string, kind: string): T {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown ${kind} ${id}`);
  return found;
}

/** The cross selection as one query sees it. */
export interface CrossScope {
  selection: CrossSelection;
  /** Visual being queried: what was picked in it does not filter it (it highlights instead). */
  visualId?: string;
  /** Fields this query does not follow (the visual's `skipFilters`). */
  skipFields?: readonly string[];
}

/**
 * WHERE of the on-screen filters plus the cross selection (items picked in other visuals);
 * `params` may already hold values ($n continues after them).
 */
export function buildWhere(
  t: Template, filters: FilterSelection, excludeField?: string | readonly string[], params: string[] = [],
  cross: CrossScope = { selection: [] },
  /** Name the fact is read under: filters on tables it does not reach are left out (default: the main fact). */
  alias: string = factSource(t).alias,
): BuiltQuery {
  const clauses: string[] = [];
  const excluded = excludeField === undefined ? [] : typeof excludeField === "string" ? [excludeField] : excludeField;
  const add = (fieldId: string, picked: readonly string[]): void => {
    const values = picked.slice(0, MAX_FILTER_VALUES);
    if (values.length === 0) return;
    const field = lookup(t.fields, fieldId, "field");
    if (!inScope(t, alias, field.sql)) return;
    const placeholders = values.map((v) => {
      params.push(String(v));
      return `$${params.length}`;
    });
    clauses.push(`${fieldValue(field)} IN (${placeholders.join(", ")})`);
  };
  for (const fieldId of t.filters) {
    if (!excluded.includes(fieldId)) add(fieldId, filters[fieldId] ?? []);
  }
  for (const entry of cross.selection) {
    if (entry.visualId === cross.visualId || cross.skipFields?.includes(entry.fieldId)) continue;
    add(entry.fieldId, entry.values);
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

/** Rows a listing shows: its limit, or the expanded one while its filter has a selection. */
export function rowsLimit(visual: Extract<Visual, { type: "rows" }>, filters: FilterSelection): number {
  const expanded = visual.expand && (filters[visual.expand.filter]?.length ?? 0) > 0;
  return expanded && visual.expand ? visual.expand.limit : visual.limit;
}

function selectFor(t: Template, visual: QueryVisual, filters: FilterSelection): { select: string[]; groupBy: string[]; tail: string } {
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
    case "rows":
      return {
        // Listed as text, exactly as stored; columns are named by position (labels live in the template).
        select: visual.columns.map((c, i) => `CAST((${c.sql}) AS VARCHAR) AS c${i}`),
        groupBy: [],
        tail: `${visual.orderBy ? `ORDER BY ${visual.orderBy} ASC ` : ""}LIMIT ${rowsLimit(visual, filters)}`,
      };
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
  cross: CrossSelection = [],
): BuiltQuery {
  const source = factSource(t, visual.fact);
  const { select, groupBy, tail } = selectFor(t, visual, filters);
  // Built apart first: the FROM only joins the dimensions the query mentions, and its parameters come first.
  const where = buildWhere(t, filters, visual.skipFilters, [], {
    selection: cross, visualId: visual.id, skipFields: visual.skipFilters,
  }, source.alias);
  // The visual's own condition narrows the screen filters, never replaces them.
  const whereSql = visual.where ? (where.sql ? `${where.sql} AND (${visual.where})` : `WHERE (${visual.where})`) : where.sql;
  const mentioned = [...select, whereSql, tail].join("\n");
  const params: string[] = [];
  const from = buildFrom(t, files, factFilter, params, (table) => mentions(mentioned, table), source);
  const shift = params.length;
  const shiftedWhere = shift === 0 ? whereSql : whereSql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + shift}`);
  params.push(...where.params);
  const sql = [
    `SELECT ${select.join(", ")}`,
    from,
    shiftedWhere,
    groupBy.length ? `GROUP BY ${groupBy.join(", ")}` : "",
    tail,
  ]
    .filter(Boolean)
    .join("\n");
  return { sql, params };
}

/** Distinct values for a filter, honouring the *other* active filters (cross-filtering). */
export function buildFilterOptionsQuery(
  t: Template,
  files: TableFiles,
  fieldId: string,
  filters: FilterSelection,
  factFilter: FactFilter = [],
  /** Items picked in the visuals narrow the options too (every visual's, this field included). */
  cross: CrossSelection = [],
): BuiltQuery {
  const field = lookup(t.fields, fieldId, "field");
  const params: string[] = [];
  // The values of every fact that has the field: the main one always, an extra one once it has data.
  const [main, ...extras] = factSources(t);
  const sources = [main, ...extras.filter((s) => files[s.table] && inScope(t, s.alias, field.sql))];
  // Facts read under the same name have the same columns: their files go in one read (as the parts of a
  // table do), so a template with a dozen block facts scans once instead of a dozen times.
  const groups = new Map<string, FactSource[]>();
  for (const source of sources) groups.set(source.alias, [...(groups.get(source.alias) ?? []), source]);
  // The field is worked out once per combination of the columns it reads, not once per row: a label built
  // by a long CASE over a column of a few dozen values costs a few dozen evaluations, whatever the table's size.
  const columns = columnsOf(t, field.sql);
  const parts = [...groups.values()].map((group) => {
    const [source] = group;
    const together = { ...files, [source.table]: joinParts(group.flatMap((s) => splitParts(files[s.table] ?? ""))) };
    const from = buildFrom(t, together, factFilter, params, undefined, source);
    const where = buildWhere(t, filters, fieldId, params, { selection: cross }, source.alias);
    const grouped = columns.length > 0 ? `GROUP BY ${columns.join(", ")}` : "";
    return [`SELECT ${grouped ? "" : "DISTINCT "}${fieldValue(field)} AS value`, from, where.sql, grouped].filter(Boolean).join("\n");
  });
  const sql = `SELECT DISTINCT value FROM (\n${parts.join("\nUNION ALL\n")}\n) AS options\nORDER BY value NULLS LAST LIMIT 500`;
  return { sql, params };
}
