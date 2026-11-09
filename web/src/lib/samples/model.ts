/**
 * What the generator knows about a template before writing any column: how many rows each table
 * gets, what the key of each dimension looks like and which fact columns point to which dimension.
 */
import type { ColumnType, Template, TemplateTable } from "../templates/schema";
import { SAMPLE_CITIES } from "./cities";
import { literalDomains, type LiteralDomains } from "./domains";
import { indexOf, pickAt, uBy } from "./sql";
import { PRODUCT_COUNT } from "./vocab";

export interface ColumnRef {
  table: string;
  column: string;
}

export interface SampleModel {
  template: Template;
  /** SQL DATE literal every date is generated before. */
  anchor: string;
  domains: LiteralDomains;
  table(name: string): TemplateTable;
  rows(table: string): number;
  /** The key column of a table: its declared key or the column relationships point to. */
  keyColumn(table: string): string | undefined;
  /** Key value at a 0-based index expression (wraps around the table's rows). */
  key(table: string, index: string): string;
  /** A key of the table chosen at random, the first rows being the most frequent. */
  anyKey(table: string, salt: string, base?: string): string;
  /** The dimension column a fact column points to. */
  target(table: string, column: string): ColumnRef | undefined;
}

export const CITY_COUNT = SAMPLE_CITIES.length;
export const GEO_KEY = /ibge|cd_municipio|cod_municipio/;
const FACT_ROWS = 12000;
const DAYS = 730;

const ROWS_BY_NAME: readonly (readonly [RegExp, number])[] = [
  [/municip/, CITY_COUNT],
  [/filia|loja/, 8],
  [/client/, 240],
  [/item|produt/, PRODUCT_COUNT],
  [/fornec/, 40],
  [/funcion|vendedor/, 18],
  [/plano|modalid|orige|cartao/, 6],
  [/candidat/, 12],
];

function defaultRows(table: TemplateTable, keyName: string | undefined): number {
  if (table.kind === "fact") return FACT_ROWS;
  const keyType = table.columns.find((c) => c.name === keyName)?.type;
  if (keyType === "date" || keyType === "timestamp") return DAYS;
  if (keyName && GEO_KEY.test(keyName)) return CITY_COUNT;
  return ROWS_BY_NAME.find(([pattern]) => pattern.test(table.name))?.[1] ?? 24;
}

function keyValue(type: ColumnType, geo: boolean, anchor: string, idx: string): string {
  if (geo) return pickAt(SAMPLE_CITIES.map((c) => c.code), idx);
  if (type === "date") return `(${anchor} - 1 - CAST(${idx} AS INTEGER))`;
  if (type === "timestamp") return `CAST((${anchor} - 1 - CAST(${idx} AS INTEGER)) AS TIMESTAMP)`;
  if (type === "boolean") return `(${idx} % 2 = 0)`;
  if (type === "text") return `CAST(1000 + ${idx} AS VARCHAR)`;
  return `(CAST(${idx} AS BIGINT) + 1)`;
}

export function buildModel(template: Template, anchor: string, rowOverrides: Readonly<Record<string, number>> = {}): SampleModel {
  const tables = new Map(template.tables.map((t) => [t.name, t]));
  const table = (name: string): TemplateTable => {
    const found = tables.get(name);
    if (!found) throw new Error(`sample data: unknown table "${name}"`);
    return found;
  };
  const keyColumn = (name: string): string | undefined =>
    table(name).key ?? template.relationships.find((r) => r.to.table === name)?.to.column;
  const rows = (name: string): number => rowOverrides[name] ?? defaultRows(table(name), keyColumn(name));
  const keyType = (name: string): ColumnType =>
    table(name).columns.find((c) => c.name === keyColumn(name))?.type ?? "integer";

  const key = (name: string, index: string): string => {
    const idx = `((${index}) % ${rows(name)})`;
    return keyValue(keyType(name), GEO_KEY.test(keyColumn(name) ?? ""), anchor, idx);
  };
  const anyKey = (name: string, salt: string, base = "i"): string => {
    const power = keyType(name) === "date" || keyType(name) === "timestamp" ? 1 : 1.6;
    return key(name, indexOf(uBy(base, salt), rows(name), power));
  };
  const target = (tableName: string, column: string): ColumnRef | undefined =>
    template.relationships.find((r) => r.from.table === tableName && r.from.column === column)?.to;

  return { template, anchor, domains: literalDomains(template), table, rows, keyColumn, key, anyKey, target };
}
