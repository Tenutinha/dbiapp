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
  columns: z.array(columnSchema).min(1),
});

const relationshipSchema = z.object({
  from: z.object({ table: ident, column: ident }),
  to: z.object({ table: ident, column: ident }),
});

/** "text" is for measures that return a label (e.g. the winning candidate), shown as-is. */
const formatSchema = z.enum(["currency", "number", "integer", "percent", "text"]);

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
    limit: z.number().int().min(1).max(1000).default(20),
    /** Measure to sort by (default: the first one), always descending. */
    orderBy: ident.optional(),
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
  })
  .superRefine((t, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: "custom", message });
    const tables = new Map(t.tables.map((tb) => [tb.name, tb]));
    const hasColumn = (table: string, column: string): boolean =>
      tables.get(table)?.columns.some((c) => c.name === column) ?? false;

    const facts = t.tables.filter((tb) => tb.kind === "fact");
    if (facts.length !== 1) issue("MVP supports exactly one fact table per template");

    for (const tb of t.tables) {
      if (tb.kind === "dimension" && !tb.key) issue(`dimension ${tb.name} needs a key`);
      if (tb.key && !tb.columns.some((c) => c.name === tb.key && c.required)) {
        issue(`${tb.name}.key must be a required column`);
      }
      for (const col of sortColumns(tb)) {
        if (!hasColumn(tb.name, col)) issue(`${tb.name}.sortBy: ${col} is not a column`);
      }
    }
    for (const r of t.relationships) {
      if (!hasColumn(r.from.table, r.from.column)) issue(`relationship from ${r.from.table}.${r.from.column} unknown`);
      if (!hasColumn(r.to.table, r.to.column)) issue(`relationship to ${r.to.table}.${r.to.column} unknown`);
      if (tables.get(r.from.table)?.kind !== "fact") issue("relationships must start at the fact table");
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
      if (v.type === "kpi" || v.type === "donut") needMeasure(v.measure, where);
      if (v.type === "bar" || v.type === "line" || v.type === "donut") needField(v.field, where);
      if (v.type === "bar" || v.type === "line" || v.type === "table") v.measures.forEach((m) => needMeasure(m, where));
      if (v.type === "table") {
        v.fields.forEach((f) => needField(f, where));
        if (v.orderBy && !v.measures.includes(v.orderBy)) issue(`${where}: orderBy must be one of its measures`);
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
