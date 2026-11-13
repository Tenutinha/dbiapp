/**
 * Declarative dashboard template format.
 *
 * A template is the web recreation of a Power BI / QlikView project:
 *  - tables + relationships = the data contract (star schema)
 *  - fields   = groupable / filterable attributes (SQL expressions over the model)
 *  - measures = DAX / Qlik expressions translated to DuckDB SQL
 *  - visuals  = layout
 *
 * Templates are authored by us (trusted). SQL in `fields`/`measures` is still
 * restricted to a conservative character set as defence in depth.
 */
import { z } from "zod";
import { DASHBOARD_ACCESS } from "../permissions";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = z.string().regex(IDENT, "use snake_case identifiers");

// No statement separators, comments or string-literal tricks beyond simple quotes.
// Letters may be accented (labels such as 'Não' inside CASE expressions).
const SAFE_SQL = /^[\p{L}\p{N}_\s.,()*+\-/<>=%'!]+$/u;
const sqlExpr = z
  .string()
  .min(1)
  .regex(SAFE_SQL, "expression contains forbidden characters")
  .refine((s) => !/(--|\/\*|\bread_|\bcopy\b|\battach\b|\binstall\b|\bload\b)/i.test(s), {
    message: "expression uses a forbidden keyword",
  });

export const COLUMN_TYPES = ["integer", "decimal", "text", "date", "timestamp", "boolean"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

const columnSchema = z.object({
  name: ident,
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().default(true),
  description: z.string().optional(),
});

/**
 * Raw file a table is fed from, when it differs from what is stored: the engate checks files against
 * these columns, and on ingest each stored column is computed from them (derive) and, with groupBy,
 * rows are summed up (e.g. votes per polling station → per municipality). Queries only ever see the
 * stored table, so measures and visuals do not change.
 */
const sourceSchema = z.object({
  description: z.string().optional(),
  /** Columns the raw file must have (names as in the file, normalized). */
  columns: z.array(columnSchema).min(1),
  /** SQL over the raw columns for a stored column; a stored column without one copies the raw column of the same name. */
  derive: z.record(ident, sqlExpr).default({}),
  /** Stored columns that identify a row: rows are grouped by them, so every other stored column must be derived with an aggregate (SUM(…), any_value(…)). */
  groupBy: z.array(ident).default([]),
});

const tableSchema = z.object({
  name: ident,
  kind: z.enum(["fact", "dimension"]),
  description: z.string(),
  /** Primary key for dimensions — must be unique and non-null. */
  key: ident.optional(),
  /**
   * Rows are sorted by these columns (comma separated, e.g. "cargo, ano, cd_municipio") when written, so
   * Parquet row-group stats prune well on the filters people use most.
   */
  sortBy: z.string().regex(/^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*){0,5}$/, "use column names separated by commas").optional(),
  /**
   * Only on an extra fact table: the fact it has the same columns as (e.g. "bloco_a_servicos", one block of
   * every period, shaped like "registros"). Its visuals read it under that fact's name, so the template's
   * fields, measures, filters and relationships written for that fact apply to it unchanged.
   */
  sameAs: ident.optional(),
  columns: z.array(columnSchema).min(1),
  source: sourceSchema.optional(),
});

const relationshipSchema = z.object({
  from: z.object({ table: ident, column: ident }),
  to: z.object({ table: ident, column: ident }),
});

/** "text" is for measures that return a label (e.g. the winning candidate), shown as-is. */
/** "currency_exact" keeps the cents and leaves the symbol out (65.769,15), for values checked against a document. */
const formatSchema = z.enum(["currency", "currency_exact", "number", "integer", "percent", "text"]);

export const TEMPLATE_ORIGINS = ["powerbi", "qlikview", "web"] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

/** Base maps shipped in /public/geo (IBGE meshes); features are keyed by the IBGE code. */
export const MAP_GEOS = ["municipio", "uf"] as const;

const fieldSchema = z.object({ id: ident, label: z.string(), sql: sqlExpr });
const measureSchema = z.object({
  id: ident,
  label: z.string(),
  sql: sqlExpr,
  format: formatSchema,
});

const span = z.number().int().min(1).max(12).default(12);
const base = {
  id: ident,
  title: z.string(),
  span,
  /** Fact table this visual reads (default: the main fact, the first one of the template). */
  fact: ident.optional(),
  /** Extra condition of this visual alone (e.g. "registros.registro = 'C100'"), on top of the screen filters. */
  where: sqlExpr.optional(),
  /** Screen filters this visual does not follow (e.g. reference records that have no month of their own). */
  skipFilters: z.array(ident).optional(),
  /** Leave the visual out of the page when it has no rows (e.g. a record type the files do not bring). */
  hideEmpty: z.boolean().optional(),
};

const visualSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("kpi"), measure: ident }),
  z.object({
    ...base,
    type: z.enum(["bar", "line"]),
    field: ident,
    measures: z.array(ident).min(1),
    sort: z.enum(["field", "measure_desc"]).default("field"),
    limit: z.number().int().min(1).max(1000).default(100),
    horizontal: z.boolean().default(false),
  }),
  z.object({
    ...base,
    type: z.literal("donut"),
    field: ident,
    measure: ident,
    limit: z.number().int().min(1).max(20).default(8),
  }),
  z.object({
    ...base,
    type: z.literal("table"),
    fields: z.array(ident).min(1),
    measures: z.array(ident).min(1),
    // Up to one line per document of a few years (the table draws them 25 at a time).
    limit: z.number().int().min(1).max(5000).default(20),
    /** Measure to sort by (default: the first one), always descending. */
    orderBy: ident.optional(),
    /**
     * "field" / "field_desc": rows in the order of the first field (e.g. month by month, or the latest month
     * first) instead of by a measure. The reader can still sort by any column on the screen.
     */
    sort: z.enum(["measure_desc", "field", "field_desc"]).optional(),
    /**
     * Closes the table with a line of totals: each measure computed over everything the table covers
     * (its condition and the screen filters), not added up from the lines shown — so it also holds for
     * averages and rates, and when the table shows only its first lines.
     */
    total: z.boolean().optional(),
    /**
     * Measures shown as the first columns, before the fields: a value that names the line but cannot be
     * grouped on (e.g. a document's key, written only on its header record while its items are added up).
     */
    leading: z.array(ident).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("map"),
    geo: z.enum(MAP_GEOS),
    /** Field holding the IBGE code of each area. */
    field: ident,
    /** Field with the area name, for the tooltip. */
    labelField: ident.optional(),
    color: z.discriminatedUnion("mode", [
      /** Each area painted with the colour a measure returns (e.g. the winner's colour). */
      z.object({
        mode: z.literal("category"),
        /** Text measure: the category shown in tooltip and legend. */
        measure: ident,
        /** Text measure returning a #rrggbb colour for the category. */
        colorMeasure: ident,
        /** Optional 0–1 measure: lower values are painted lighter. */
        strengthMeasure: ident.optional(),
      }),
      /** Areas painted on a continuous scale. */
      z.object({
        mode: z.literal("scale"),
        measure: ident,
        scheme: z.enum(["sequential", "diverging"]).default("sequential"),
      }),
    ]),
    /** Extra measures shown in the tooltip. */
    tooltip: z.array(ident).default([]),
  }),
  /**
   * Plain listing of rows, not aggregated: the original data as it came (e.g. every field of a SPED
   * record type). Columns carry their own label and expression instead of pointing to fields.
   */
  z.object({
    ...base,
    type: z.literal("rows"),
    columns: z.array(z.object({ label: z.string().min(1).max(80), sql: sqlExpr })).min(1).max(80),
    /** Expression the rows are ordered by, ascending (e.g. the line number in the file). */
    orderBy: sqlExpr.optional(),
    limit: z.number().int().min(1).max(1000).default(100),
    /** More rows while a screen filter is in use (e.g. a short sample of every record; many rows of the chosen one). */
    expand: z.object({ filter: ident, limit: z.number().int().min(1).max(5000) }).optional(),
  }),
  /** Static explanatory text (paragraphs separated by a blank line). No query. */
  z.object({
    ...base,
    type: z.literal("text"),
    body: z.string().min(1).max(4000),
  }),
]);

/** A section of the dashboard page: a titled, described group of visuals (e.g. "A força da vitória"). */
const analysisSchema = z.object({
  id: ident,
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  /** Visual ids shown in this section, in order. */
  visuals: z.array(ident).default([]),
  /**
   * "row": the visuals side by side in one strip that scrolls sideways, each almost as wide as the page
   * (e.g. the same values by month, then by document), instead of the usual grid.
   */
  layout: z.enum(["grid", "row"]).optional(),
  /**
   * Off the air (e.g. while it is being built): left out of the summary and of the page for whoever
   * reads the dashboard; still shown, marked, in the catalog preview.
   */
  hidden: z.boolean().default(false),
});

/** One group of the summary shown in the sidebar (e.g. "O resultado" → its analyses). */
const summaryGroupSchema = z.object({
  title: z.string().min(1).max(120),
  analyses: z.array(ident).min(1),
});

export const templateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.number().int().min(1),
    name: z.string(),
    area: z.string(),
    origin: z.enum(TEMPLATE_ORIGINS),
    description: z.string(),
    tables: z.array(tableSchema).min(1),
    relationships: z.array(relationshipSchema),
    fields: z.array(fieldSchema),
    measures: z.array(measureSchema).min(1),
    filters: z.array(ident),
    /**
     * Filters that always hold exactly one value (single choice, never cleared). The value lists the
     * preferred values, comma separated ("2026, 2024"); when none exists in the data, the greatest
     * available value is used. For measures that only make sense within one slice, e.g. one election.
     */
    filterDefaults: z.record(ident, z.string().min(1).max(200)).default({}),
    visuals: z.array(visualSchema).min(1),
    /** Page sections. Visuals left out of every analysis are shown before the first one. */
    analyses: z.array(analysisSchema).default([]),
    /** Sidebar summary: groups of analyses, in reading order. */
    summary: z.array(summaryGroupSchema).default([]),
    /**
     * "horizontal": each analysis is a page of its own, side by side, and the reader turns them sideways
     * (tabs above, the summary or a swipe), like the pages of a report. Default: one below the other.
     */
    paging: z.enum(["vertical", "horizontal"]).optional(),
    /**
     * Extra restriction on every dashboard built on this template. "platformAdmin": only the platform
     * administrator sees it (internal dashboards); it never shows in the showcase nor opens through links.
     */
    access: z.enum(DASHBOARD_ACCESS).optional(),
  })
  .superRefine((t, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: "custom", message });
    const tables = new Map(t.tables.map((tb) => [tb.name, tb]));
    const hasColumn = (table: string, column: string): boolean =>
      tables.get(table)?.columns.some((c) => c.name === column) ?? false;

    // The first fact is the main one (data filter, row count); the others are read by the visuals that name them.
    const facts = t.tables.filter((tb) => tb.kind === "fact");
    if (facts.length === 0) issue("a template needs a fact table");
    for (const tb of t.tables) {
      if (tb.sameAs === undefined) continue;
      const target = tables.get(tb.sameAs);
      if (tb.kind !== "fact" || target?.kind !== "fact" || target.sameAs !== undefined || target.name === tb.name || tb === facts[0]) {
        issue(`${tb.name}.sameAs must name another fact table (and the main fact cannot have it)`);
      } else if (JSON.stringify(tb.columns.map((c) => [c.name, c.type])) !== JSON.stringify(target.columns.map((c) => [c.name, c.type]))) {
        issue(`${tb.name} must have the same columns as ${target.name}`);
      }
    }

    for (const tb of t.tables) {
      if (tb.kind === "dimension" && !tb.key) issue(`dimension ${tb.name} needs a key`);
      if (tb.key && !tb.columns.some((c) => c.name === tb.key && c.required)) {
        issue(`${tb.name}.key must be a required column`);
      }
      for (const col of sortColumns(tb)) {
        if (!hasColumn(tb.name, col)) issue(`${tb.name}.sortBy: ${col} is not a column`);
      }
    }
    for (const tb of t.tables) {
      if (!tb.source) continue;
      const raw = new Set(tb.source.columns.map((c) => c.name));
      const stored = new Set(tb.columns.map((c) => c.name));
      for (const col of Object.keys(tb.source.derive)) {
        if (!stored.has(col)) issue(`${tb.name}.source.derive: ${col} is not a column of the table`);
      }
      for (const col of tb.source.groupBy) {
        if (!stored.has(col)) issue(`${tb.name}.source.groupBy: ${col} is not a column of the table`);
      }
      for (const col of tb.columns) {
        const derived = col.name in tb.source.derive;
        if (!derived && !raw.has(col.name)) issue(`${tb.name}.${col.name}: not derived and not a raw column`);
        if (tb.source.groupBy.length > 0 && !derived && !tb.source.groupBy.includes(col.name)) {
          issue(`${tb.name}.${col.name}: with groupBy, every other column must be derived with an aggregate`);
        }
      }
    }
    // Snowflake: a relationship starts at the fact or at a dimension already joined (in this order).
    const joined = new Set(facts.map((f) => f.name));
    for (const r of t.relationships) {
      if (!hasColumn(r.from.table, r.from.column)) issue(`relationship from ${r.from.table}.${r.from.column} unknown`);
      if (!hasColumn(r.to.table, r.to.column)) issue(`relationship to ${r.to.table}.${r.to.column} unknown`);
      if (!joined.has(r.from.table)) {
        issue(`relationship from ${r.from.table}: start at the fact table or at a dimension joined by an earlier relationship`);
      }
      joined.add(r.to.table);
    }

    const fieldIds = new Set(t.fields.map((f) => f.id));
    const measureIds = new Set(t.measures.map((m) => m.id));
    const needField = (id: string, where: string): void => {
      if (!fieldIds.has(id)) issue(`${where}: unknown field "${id}"`);
    };
    const needMeasure = (id: string, where: string): void => {
      if (!measureIds.has(id)) issue(`${where}: unknown measure "${id}"`);
    };

    t.filters.forEach((f) => needField(f, "filters"));
    for (const f of Object.keys(t.filterDefaults)) {
      if (!t.filters.includes(f)) issue(`filterDefaults: "${f}" is not one of the filters`);
    }
    for (const v of t.visuals) {
      const where = `visual ${v.id}`;
      if (v.fact !== undefined && tables.get(v.fact)?.kind !== "fact") issue(`${where}: "${v.fact}" is not a fact table`);
      if (v.type === "kpi" || v.type === "donut") needMeasure(v.measure, where);
      if (v.type === "bar" || v.type === "line" || v.type === "donut") needField(v.field, where);
      if (v.type === "bar" || v.type === "line" || v.type === "table") v.measures.forEach((m) => needMeasure(m, where));
      if (v.type === "table") {
        v.fields.forEach((f) => needField(f, where));
        if (v.orderBy && !v.measures.includes(v.orderBy)) issue(`${where}: orderBy must be one of its measures`);
        for (const m of v.leading ?? []) if (!v.measures.includes(m)) issue(`${where}: leading "${m}" must be one of its measures`);
      }
      if (v.type === "map") {
        needField(v.field, where);
        if (v.labelField) needField(v.labelField, where);
        needMeasure(v.color.measure, where);
        if (v.color.mode === "category") {
          needMeasure(v.color.colorMeasure, where);
          if (v.color.strengthMeasure) needMeasure(v.color.strengthMeasure, where);
        }
        v.tooltip.forEach((m) => needMeasure(m, where));
      }
    }
    checkAnalyses(t, issue);
  });

type AnalysesInput = {
  visuals: { id: string }[];
  analyses: z.infer<typeof analysisSchema>[];
  summary: z.infer<typeof summaryGroupSchema>[];
};

/** Analyses point to existing visuals (each visual in at most one); the summary lists each analysis at most once. */
function checkAnalyses(t: AnalysesInput, issue: (message: string) => void): void {
  const visualIds = new Set(t.visuals.map((v) => v.id));
  const analysisIds = new Set<string>();
  const placed = new Set<string>();
  for (const a of t.analyses) {
    if (analysisIds.has(a.id)) issue(`analysis id "${a.id}" is repeated`);
    analysisIds.add(a.id);
    for (const v of a.visuals) {
      if (!visualIds.has(v)) issue(`analysis ${a.id}: unknown visual "${v}"`);
      else if (placed.has(v)) issue(`visual "${v}" is in more than one analysis`);
      placed.add(v);
    }
  }
  const listed = new Set<string>();
  for (const g of t.summary) {
    for (const a of g.analyses) {
      if (!analysisIds.has(a)) issue(`summary "${g.title}": unknown analysis "${a}"`);
      else if (listed.has(a)) issue(`analysis "${a}" appears more than once in the summary`);
      listed.add(a);
    }
  }
}

export type Template = z.infer<typeof templateSchema>;

/** What a file must look like to feed `table`: its raw source when it has one, else the table itself. */
export function inputTable<T extends { columns: unknown[]; source?: { columns: unknown[] } }>(table: T): T {
  return table.source ? { ...table, columns: table.source.columns, source: undefined } : table;
}

/** The main fact: the first fact table (the data filter and the row count are about it). */
export function mainFact(t: Pick<Template, "id" | "tables">): TemplateTable {
  const fact = t.tables.find((tb) => tb.kind === "fact");
  if (!fact) throw new Error(`template ${t.id} has no fact table`);
  return fact;
}

/** Fact tables besides the main one. A dashboard may be published before they have data. */
export function extraFacts(t: Pick<Template, "tables">): TemplateTable[] {
  return t.tables.filter((tb) => tb.kind === "fact").slice(1);
}

/** Columns a table is sorted by when written (sortBy is a comma separated list). */
export function sortColumns(table: { sortBy?: string }): string[] {
  return table.sortBy ? table.sortBy.split(",").map((c) => c.trim()).filter(Boolean) : [];
}
export type TemplateTable = Template["tables"][number];
export type TemplateColumn = TemplateTable["columns"][number];
export type Visual = Template["visuals"][number];
export type Measure = Template["measures"][number];
export type Field = Template["fields"][number];
export type ValueFormat = Measure["format"];
export type MapVisual = Extract<Visual, { type: "map" }>;
export type Analysis = Template["analyses"][number];
export type SummaryGroup = Template["summary"][number];
