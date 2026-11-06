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
  /** Rows are sorted by this column when written, so Parquet row-group stats prune well. */
  sortBy: ident.optional(),
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
const base = { id: ident, title: z.string(), span };

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
  /** Static explanatory text (paragraphs separated by a blank line). No query. */
  z.object({
    ...base,
    type: z.literal("text"),
    body: z.string().min(1).max(4000),
  }),
]);

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
     * Filters that always hold exactly one value (single choice, never cleared), with the value used
     * when nothing is chosen. For measures that only make sense within one slice, e.g. one election.
     */
    filterDefaults: z.record(ident, z.string().min(1).max(200)).default({}),
    visuals: z.array(visualSchema).min(1),
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
      if (tb.sortBy && !hasColumn(tb.name, tb.sortBy)) issue(`${tb.name}.sortBy is not a column`);
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
  });

export type Template = z.infer<typeof templateSchema>;
export type TemplateTable = Template["tables"][number];
export type TemplateColumn = TemplateTable["columns"][number];
export type Visual = Template["visuals"][number];
export type Measure = Template["measures"][number];
export type Field = Template["fields"][number];
export type ValueFormat = Measure["format"];
export type MapVisual = Extract<Visual, { type: "map" }>;
