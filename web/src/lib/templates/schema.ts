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
const SAFE_SQL = /^[\w\s.,()*+\-/<>=%'!]+$/;
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

const formatSchema = z.enum(["currency", "number", "integer", "percent"]);

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
  }),
]);

export const templateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.number().int().min(1),
    name: z.string(),
    area: z.string(),
    origin: z.enum(["powerbi", "qlikview"]),
    description: z.string(),
    tables: z.array(tableSchema).min(1),
    relationships: z.array(relationshipSchema),
    fields: z.array(fieldSchema),
    measures: z.array(measureSchema).min(1),
    filters: z.array(ident),
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
    for (const v of t.visuals) {
      const where = `visual ${v.id}`;
      if (v.type === "kpi" || v.type === "donut") needMeasure(v.measure, where);
      if (v.type === "bar" || v.type === "line" || v.type === "donut") needField(v.field, where);
      if (v.type === "bar" || v.type === "line" || v.type === "table") v.measures.forEach((m) => needMeasure(m, where));
      if (v.type === "table") v.fields.forEach((f) => needField(f, where));
    }
  });

export type Template = z.infer<typeof templateSchema>;
export type TemplateTable = Template["tables"][number];
export type TemplateColumn = TemplateTable["columns"][number];
export type Visual = Template["visuals"][number];
export type Measure = Template["measures"][number];
export type Field = Template["fields"][number];
export type ValueFormat = Measure["format"];
