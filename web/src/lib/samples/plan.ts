/**
 * Turns a template into one SELECT per table that produces its sample rows. Hand-written recipes
 * describe what must be coherent (a title's dates and status); everything else is generic.
 */
import type { ColumnType, Template, TemplateColumn, TemplateTable } from "../templates/schema";
import { genericColumn } from "./generic";
import { buildModel, CITY_COUNT, GEO_KEY, type SampleModel } from "./model";
import { recipeFor } from "./recipes";
import { indexOf, u } from "./sql";
import type { Recipe, SampleContext, TableRecipe } from "./types";
import { PRODUCT_COUNT } from "./vocab";

export interface PlannedTable {
  name: string;
  rows: number;
  /** SELECT returning the table's rows with the contract's column names and types. */
  select: string;
}

export interface SamplePlan {
  tables: readonly PlannedTable[];
  factRows: number;
}

const SQL_TYPE: Readonly<Record<ColumnType, string>> = {
  integer: "BIGINT", decimal: "DOUBLE", text: "VARCHAR", date: "DATE", timestamp: "TIMESTAMP", boolean: "BOOLEAN",
};

/** `g` (city index) and `p` (product index): the row itself where the table lists cities or products. */
function helpers(model: SampleModel, table: TemplateTable): Readonly<Record<string, string>> {
  const dimension = table.kind === "dimension";
  const geoTable = dimension && GEO_KEY.test(model.keyColumn(table.name) ?? "");
  const g = geoTable ? "i" : dimension && /filia|loja/.test(table.name) ? `(i % ${CITY_COUNT})` : indexOf(u("geo"), CITY_COUNT, 2);
  const p = dimension && /item|produt/.test(table.name) ? "i" : indexOf(u("prod"), PRODUCT_COUNT);
  return { g, p };
}

function columnExpr(model: SampleModel, table: TemplateTable, column: TemplateColumn, recipe: TableRecipe): string {
  const written = recipe.columns?.[column.name];
  if (written) return written;
  const base = recipe.seedBy?.[column.name] ?? "i";
  if (column.name === model.keyColumn(table.name)) return model.key(table.name, "i");
  const target = model.target(table.name, column.name);
  if (target) return model.anyKey(target.table, column.name, base);
  return genericColumn({ model, table, column, base });
}

function selectFor(model: SampleModel, table: TemplateTable, recipe: TableRecipe): string {
  const stages = [helpers(model, table), ...(recipe.stages ?? [])];
  const ctes = stages.map((stage, n) => {
    const names = Object.entries(stage).map(([name, expr]) => `${expr} AS ${name}`).join(", ");
    return `s${n + 1} AS (SELECT *, ${names} FROM s${n})`;
  });
  const columns = table.columns.map(
    (c) => `CAST(${columnExpr(model, table, c, recipe)} AS ${SQL_TYPE[c.type]}) AS "${c.name}"`,
  );
  const source = `s0 AS (SELECT i FROM range(${model.rows(table.name)}) t(i))`;
  return `WITH ${[source, ...ctes].join(", ")} SELECT ${columns.join(", ")} FROM s${stages.length}`;
}

export function buildSamplePlan(template: Template, anchor: string, recipe: Recipe | undefined = recipeFor(template.id)): SamplePlan {
  const model = buildModel(template, anchor, recipe?.rows);
  const ctx: SampleContext = { anchor, key: model.key, anyKey: model.anyKey, rows: model.rows };
  const written = recipe?.tables(ctx) ?? {};
  const tables = template.tables.map((table): PlannedTable => ({
    name: table.name,
    rows: model.rows(table.name),
    select: selectFor(model, table, written[table.name] ?? {}),
  }));
  const fact = template.tables.find((t) => t.kind === "fact");
  return { tables, factRows: fact ? model.rows(fact.name) : 0 };
}
