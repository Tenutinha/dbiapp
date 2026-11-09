/**
 * Fills a column nobody described by hand: reads the column name, its table and the values the
 * template compares it with, and returns a plausible SQL expression. Expressions use the row index
 * `i` (or the given seed), the city index `g` and the product index `p`.
 */
import type { TemplateColumn, TemplateTable } from "../templates/schema";
import { SAMPLE_CITIES } from "./cities";
import type { SampleModel } from "./model";
import { between, indexOf, lit, money, pickAt, uBy, weighted } from "./sql";
import {
  BRANDS, CHANNELS, COLORS, COMPANY_KINDS, COMPANY_NAMES, FIRST_NAMES, GENERIC_STATUS, JOB_TITLES, LAST_NAMES,
  PARTIES, PRODUCT_VARIANTS, PRODUCTS, SEGMENTS, SPECTRUM, WAREHOUSES,
} from "./vocab";

export interface ColumnRequest {
  model: SampleModel;
  table: TemplateTable;
  column: TemplateColumn;
  /** Integer SQL expression the randomness derives from: `i`, or what groups rows together. */
  base: string;
}

interface Scope {
  t: string;
  c: string;
  /** Index for names: the row itself in dimensions, a random one in facts. */
  idx: string;
  anchor: string;
  rnd(salt: string): string;
}

type Rule = readonly [applies: (s: Scope) => boolean, expr: (s: Scope) => string];

const cityNames = SAMPLE_CITIES.map((c) => c.name);
const nouns = PRODUCTS.map((p) => p.noun);
const productName = `${pickAt(nouns, "p")} || ' ' || ${pickAt(PRODUCT_VARIANTS, `(p // ${nouns.length})`)}`;
const label = (column: string): string => {
  const text = column.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const TEXT_RULES: readonly Rule[] = [
  [(s) => /(^|_)uf($|_)/.test(s.c), () => pickAt(SAMPLE_CITIES.map((c) => c.uf), "g")],
  [(s) => /ibge|cd_municipio|cod_municipio/.test(s.c), () => pickAt(SAMPLE_CITIES.map((c) => c.code), "g")],
  [(s) => /regiao/.test(s.c), () => pickAt(SAMPLE_CITIES.map((c) => c.region), "g")],
  [(s) => /cidade|municipio/.test(s.c) || (/municip/.test(s.t) && /^nome/.test(s.c)), () => pickAt(cityNames, "g")],
  [
    (s) => /filia|loja/.test(s.t) && /fantasia|^loja$|^filial$|^nome/.test(s.c),
    (s) => `${lit(/filia/.test(s.t) ? "Filial " : "Loja ")} || ${pickAt(cityNames, "g")}`,
  ],
  [(s) => s.c === "codigo_e_descricao", () => `CAST(1000 + p AS VARCHAR) || ' - ' || ${productName}`],
  [(s) => /item|produt/.test(s.t) && /descri|^produto$|^nome/.test(s.c), () => productName],
  [(s) => /linha|categoria/.test(s.c), () => pickAt(PRODUCTS.map((p) => p.line), "p")],
  [(s) => /^sub_?grupo/.test(s.c), () => pickAt(nouns, "p")],
  [(s) => /^grupo/.test(s.c), () => pickAt(PRODUCTS.map((p) => p.group), "p")],
  [(s) => /marca/.test(s.c), () => pickAt(BRANDS, `(p * 7 + p // ${nouns.length})`)],
  [(s) => /canal/.test(s.c), (s) => pickAt(CHANNELS, s.idx)],
  [(s) => /segmento/.test(s.c), (s) => pickAt(SEGMENTS, `(${s.idx} * 3 + ${s.idx} // 4)`)],
  [
    (s) => /funcion|vendedor|candidat|pessoa/.test(s.t) && /nome/.test(s.c),
    (s) => `${pickAt(FIRST_NAMES, s.idx)} || ' ' || ${pickAt(LAST_NAMES, `(${s.idx} // ${FIRST_NAMES.length} + ${s.idx})`)}`,
  ],
  [
    (s) => /razao/.test(s.c) || (/client|fornec|empresa/.test(s.t) && /nome|^cliente$|^fornecedor$/.test(s.c)),
    (s) => `${pickAt(COMPANY_NAMES, s.idx)} || ' ' || ${pickAt(COMPANY_KINDS, `(${s.idx} // ${COMPANY_NAMES.length})`)}`,
  ],
  [(s) => /abc|classe|curva/.test(s.c), (s) => weighted([["'A'", 0.2], ["'B'", 0.3], ["'C'", 0.5]], s.rnd("abc"))],
  [(s) => /cargo/.test(s.c), (s) => pickAt(JOB_TITLES, s.idx)],
  [(s) => /partido/.test(s.c), (s) => pickAt(PARTIES, s.idx)],
  [(s) => /(^|_)cor$/.test(s.c), (s) => pickAt(COLORS, s.idx)],
  [(s) => /espectro/.test(s.c), (s) => pickAt(SPECTRUM, s.idx)],
  [(s) => /deposito/.test(s.c), (s) => pickAt(WAREHOUSES, indexOf(s.rnd("dep"), WAREHOUSES.length, 2))],
  [(s) => /status|situacao/.test(s.c), (s) => pickAt(GENERIC_STATUS, indexOf(s.rnd("st"), GENERIC_STATUS.length))],
  [(s) => /^ano$|_ano$|^ano_/.test(s.c), (s) => `CAST(year(${s.anchor}) - ${s.idx} % 2 AS VARCHAR)`],
  [(s) => /numero|^nr|codigo/.test(s.c), (s) => `CAST(100 + ${s.idx} AS VARCHAR)`],
];

const NUMBER_RULES: readonly Rule[] = [
  [(s) => /^ano$|_ano$|^ano_/.test(s.c), (s) => `(year(${s.anchor}) - ${indexOf(s.rnd("ano"), 2)})`],
  [(s) => /^mes$|_mes$/.test(s.c), (s) => `(1 + ${indexOf(s.rnd("mes"), 12)})`],
  [(s) => /qtd|quantidade/.test(s.c), (s) => `(1 + ${indexOf(s.rnd("q"), 9, 2)})`],
  [(s) => /populacao/.test(s.c), (s) => `floor(${between(50000, 5000000, s.rnd("pop"), 3)})`],
  [(s) => /votos/.test(s.c), (s) => `floor(${between(100, 20000, s.rnd("v"), 2)})`],
  [(s) => /dias/.test(s.c), (s) => indexOf(s.rnd("d"), 90)],
  [(s) => /desconto|juros|multa/.test(s.c), (s) => money(between(0, 50, s.rnd("x"), 2))],
  [(s) => /pct|percent|taxa|margem/.test(s.c), (s) => `round(${s.rnd("pct")}, 4)`],
  [(s) => /limite/.test(s.c), (s) => `round(${between(1000, 50000, s.rnd("lim"), 2)}, -2)`],
];

/** Values the template compares the column with: the first is the most frequent. */
function fromDomain(column: TemplateColumn, values: readonly string[], uniform: string): string | null {
  const numeric = column.type === "integer" || column.type === "decimal";
  if (!numeric && column.type !== "text") return null;
  const usable = numeric ? values.filter((v) => /^-?\d+(\.\d+)?$/.test(v)) : values;
  if (usable.length === 0) return null;
  const sql = (v: string): string => (numeric ? v : lit(v));
  if (usable.length > 1) return weighted(usable.map((v, n) => [sql(v), n === 0 ? 3 : 1] as const), uniform);
  const other = numeric ? `(${usable[0]} + 1)` : lit("Outros");
  return weighted([[sql(usable[0]), 0.85], [other, 0.15]], uniform);
}

function byType(column: TemplateColumn, s: Scope): string {
  const daysAgo = `(${s.anchor} - 1 - CAST(floor(${s.rnd("dt")} * 730) AS INTEGER))`;
  switch (column.type) {
    case "text":
      return `${lit(`${label(column.name)} `)} || CAST(1 + ${s.idx} % 12 AS VARCHAR)`;
    case "decimal":
      return money(between(20, 2500, s.rnd("n"), 2));
    case "integer":
      return `(1 + ${indexOf(s.rnd("n"), 100)})`;
    case "boolean":
      return /municip/.test(s.t) && /capital/.test(s.c)
        ? `(${pickAt(SAMPLE_CITIES.map((c) => String(c.capital)), "g")} = 'true')`
        : `(${s.rnd("b")} < 0.3)`;
    case "date":
      return daysAgo;
    case "timestamp":
      return `CAST(${daysAgo} AS TIMESTAMP)`;
  }
}

export function genericColumn({ model, table, column, base }: ColumnRequest): string {
  const rnd = (salt: string): string => uBy(base, `${column.name}:${salt}`);
  const scope: Scope = {
    t: table.name,
    c: column.name,
    idx: table.kind === "fact" ? indexOf(rnd("idx"), 1000) : base,
    anchor: model.anchor,
    rnd,
  };
  const domain = model.domains.get(`${table.name}.${column.name}`);
  const literal = domain ? fromDomain(column, domain, rnd("dom")) : null;
  if (literal) return literal;
  const rules = column.type === "text" ? TEXT_RULES : column.type === "integer" || column.type === "decimal" ? NUMBER_RULES : [];
  return rules.find(([applies]) => applies(scope))?.[1](scope) ?? byType(column, scope);
}
