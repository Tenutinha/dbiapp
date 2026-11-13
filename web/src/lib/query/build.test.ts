import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "../templates/schema";
import { buildFilterOptionsQuery, buildVisualQuery, buildWhere, MissingFactError, type QueryVisual } from "./build";

const t = loadTemplate("vendas-executivo");
const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `/data/${tb.name}.parquet`]));
const visual = (id: string) => t.visuals.find((v) => v.id === id)! as QueryVisual;

describe("buildWhere", () => {
  it("binds filter values as parameters, never inline", () => {
    const where = buildWhere(t, { regiao: ["Sul", "x' OR 1=1 --"], canal: [] });
    expect(where.sql).toBe("WHERE COALESCE(CAST((dim_loja.regiao) AS VARCHAR), '(sem cadastro)') IN ($1, $2)");
    expect(where.params).toEqual(["Sul", "x' OR 1=1 --"]);
  });

  it("ignores selections for fields that are not template filters", () => {
    expect(buildWhere(t, { produto: ["X"] })).toEqual({ sql: "", params: [] });
  });
});

describe("buildVisualQuery", () => {
  it("joins only the dimensions the query uses", () => {
    const kpi = buildVisualQuery(t, files, visual("k_receita"), {});
    expect(kpi.sql).toContain("FROM read_parquet('/data/fato_vendas.parquet') AS fato_vendas");
    expect(kpi.sql).not.toContain("LEFT JOIN");
    expect(kpi.sql).not.toContain("GROUP BY");

    const byRegion = buildVisualQuery(t, files, visual("receita_regiao"), {});
    expect(byRegion.sql).toContain("LEFT JOIN read_parquet('/data/dim_loja.parquet') AS dim_loja ON fato_vendas.id_loja = dim_loja.id_loja");
    expect(byRegion.sql).not.toContain("dim_produto");

    // A screen filter on a dimension brings its join in, even when the visual itself does not use it.
    const filtered = buildVisualQuery(t, files, visual("k_receita"), { regiao: ["Sul"] });
    expect(filtered.sql).toContain("AS dim_loja ON");
    expect(filtered.params).toEqual(["Sul"]);
  });

  it("computes the measure of a KPI's detail line in the same query", () => {
    const other = t.measures.find((m) => m.id !== "receita")!;
    const kpi = buildVisualQuery(t, files, { ...visual("k_receita"), detail: { measure: other.id, text: "x" } } as QueryVisual, {});
    expect(kpi.sql).toContain(`${other.sql} AS ${other.id}`);
    expect(kpi.sql).not.toContain("GROUP BY");
  });

  it("adds the visual's own condition to the screen filters, and can skip some of them", () => {
    const own = { ...visual("k_receita"), where: "fato_vendas.quantidade > 1" };
    expect(buildVisualQuery(t, files, own, {}).sql).toContain("WHERE (fato_vendas.quantidade > 1)");
    const both = buildVisualQuery(t, files, own, { ano: ["2025"] });
    expect(both.sql).toMatch(/WHERE .* IN \(\$1\) AND \(fato_vendas\.quantidade > 1\)/);
    const skipped = buildVisualQuery(t, files, { ...own, skipFilters: ["ano"] }, { ano: ["2025"] });
    expect(skipped.params).toEqual([]);
    expect(skipped.sql).not.toContain("$1");
  });

  it("orders a table by its first field when asked, instead of by a measure", () => {
    const table: QueryVisual = {
      id: "t", type: "table", title: "Por ano", span: 12, limit: 50, sort: "field", fields: ["ano"], measures: ["receita"],
    };
    expect(buildVisualQuery(t, files, table, {}).sql).toMatch(/ORDER BY ano ASC LIMIT 50$/);
    expect(buildVisualQuery(t, files, { ...table, sort: "field_desc" }, {}).sql).toMatch(/ORDER BY ano DESC LIMIT 50$/);
    expect(buildVisualQuery(t, files, { ...table, sort: "measure_desc" }, {}).sql).toMatch(/ORDER BY receita DESC NULLS LAST LIMIT 50$/);
  });

  it("lists rows as they are, without grouping", () => {
    const rows: QueryVisual = {
      id: "r", type: "rows", title: "Linhas", span: 12, limit: 50, orderBy: "fato_vendas.id_venda",
      columns: [{ label: "Pedido", sql: "fato_vendas.id_venda" }, { label: "Loja", sql: "dim_loja.loja" }],
    };
    const q = buildVisualQuery(t, files, rows, {});
    expect(q.sql).toContain("SELECT CAST((fato_vendas.id_venda) AS VARCHAR) AS c0, CAST((dim_loja.loja) AS VARCHAR) AS c1");
    expect(q.sql).toMatch(/ORDER BY fato_vendas\.id_venda ASC LIMIT 50$/);
    expect(q.sql).not.toContain("GROUP BY");
    expect(q.sql).toContain("AS dim_loja ON");
  });

  it("groups and orders bar charts by the first measure", () => {
    const q = buildVisualQuery(t, files, visual("receita_categoria"), { ano: ["2025"] });
    expect(q.sql).toMatch(/GROUP BY 1\nORDER BY receita DESC NULLS LAST LIMIT 100$/);
    expect(q.params).toEqual(["2025"]);
  });

  it("groups tables by all their fields", () => {
    const q = buildVisualQuery(t, files, visual("top_produtos"), {});
    expect(q.sql).toContain("GROUP BY 1, 2");
    expect(q.sql).toContain("LIMIT 10");
  });

  it("escapes quotes in file paths", () => {
    const q = buildVisualQuery(t, { ...files, fato_vendas: "/d/o'brien.parquet" }, visual("k_receita"), {});
    expect(q.sql).toContain("read_parquet('/d/o''brien.parquet')");
  });

  it("fails loudly when a table file is missing", () => {
    expect(() => buildVisualQuery(t, { fato_vendas: "/x.parquet" }, visual("k_receita"), {})).toThrow(/missing file/);
  });
});

describe("buildFilterOptionsQuery", () => {
  it("applies the other filters but not its own (cross-filtering)", () => {
    const q = buildFilterOptionsQuery(t, files, "regiao", { regiao: ["Sul"], canal: ["E-commerce"] });
    expect(q.params).toEqual(["E-commerce"]);
    expect(q.sql).not.toContain("dim_loja.regiao) AS VARCHAR), '(sem cadastro)') IN");
    // The label is worked out once per value of the column it reads, then the labels are made distinct.
    expect(q.sql.startsWith("SELECT DISTINCT value FROM (\nSELECT COALESCE(")).toBe(true);
    expect(q.sql).toContain("GROUP BY dim_loja.regiao");
  });
});

describe("dashboard data filter (fact table)", () => {
  const factFilter = [{ column: "id_loja", op: "in" as const, values: ["L01"] }];

  it("reads the fact table through the filter, keeping its alias for joins and measures", () => {
    const q = buildVisualQuery(t, files, visual("k_receita"), {}, factFilter);
    expect(q.sql).toContain(
      `FROM (SELECT * FROM read_parquet('/data/fato_vendas.parquet') WHERE CAST("id_loja" AS VARCHAR) IN ($1)) AS fato_vendas`,
    );
    expect(q.params).toEqual(["L01"]);
  });

  it("numbers the on-screen filter values after the data filter's", () => {
    const q = buildVisualQuery(t, files, visual("receita_categoria"), { ano: ["2025"] }, factFilter);
    expect(q.params).toEqual(["L01", "2025"]);
    expect(q.sql).toContain("IN ($2)");
  });

  it("also limits the options offered by the on-screen filters", () => {
    const q = buildFilterOptionsQuery(t, files, "regiao", {}, factFilter);
    expect(q.sql).toContain(`WHERE CAST("id_loja" AS VARCHAR) IN ($1)`);
    expect(q.params).toEqual(["L01"]);
  });

  it("is a plain read_parquet without a filter", () => {
    expect(buildVisualQuery(t, files, visual("k_receita"), {}, []).sql).toContain("FROM read_parquet('/data/fato_vendas.parquet') AS fato_vendas");
  });
});


describe("more than one fact", () => {
  // A second fact shaped like the main one (same columns), read under its name; and one of another shape.
  const main = t.tables.find((tb) => tb.kind === "fact")!;
  const multi = templateSchema.parse({
    ...t,
    tables: [
      ...t.tables,
      { ...main, name: "fato_vendas_antigas", sameAs: main.name },
      { name: "fato_metas", kind: "fact", description: "Metas", columns: [{ name: "id_loja", type: "text" }, { name: "meta", type: "decimal" }] },
    ],
    measures: [...t.measures, { id: "meta", label: "Meta", sql: "SUM(fato_metas.meta)", format: "currency" }],
    visuals: [
      ...t.visuals,
      { ...visual("k_receita"), id: "k_receita_antiga", fact: "fato_vendas_antigas" },
      { id: "k_meta", type: "kpi", title: "Meta", measure: "meta", fact: "fato_metas" },
    ],
  });
  const all = { ...files, fato_vendas_antigas: "/data/antigas.parquet", fato_metas: "/data/metas.parquet" };
  const of = (id: string) => multi.visuals.find((v) => v.id === id)! as QueryVisual;

  it("reads a same-shaped fact under the main fact's name, with its joins and filters", () => {
    const q = buildVisualQuery(multi, all, of("k_receita_antiga"), { regiao: ["Sul"] });
    expect(q.sql).toContain("FROM read_parquet('/data/antigas.parquet') AS fato_vendas");
    expect(q.sql).toContain("AS dim_loja ON fato_vendas.id_loja = dim_loja.id_loja");
    expect(q.params).toEqual(["Sul"]);
  });

  it("leaves out the filters a fact of another shape does not reach", () => {
    const q = buildVisualQuery(multi, all, of("k_meta"), { regiao: ["Sul"] });
    expect(q.sql).toContain("FROM read_parquet('/data/metas.parquet') AS fato_metas");
    expect(q.sql).not.toContain("WHERE");
    expect(q.params).toEqual([]);
  });

  it("offers in a filter the values of every fact that has the field", () => {
    const q = buildFilterOptionsQuery(multi, all, "regiao", { canal: ["Loja"] });
    // Facts read under the same name go in one read, as the parts of one table.
    expect(q.sql.match(/SELECT DISTINCT/g)).toHaveLength(1);
    expect(q.sql).toContain("FROM read_parquet(['/data/fato_vendas.parquet', '/data/antigas.parquet']) AS fato_vendas");
    expect(q.sql).not.toContain("UNION");
    expect(q.sql).not.toContain("/data/metas.parquet");
    expect(q.params).toEqual(["Loja"]);
  });

  it("joins the values of facts of different shapes that reach the field", () => {
    // The targets fact reaches the stores too: its regions are offered along with the sales'.
    const reaching = templateSchema.parse({
      ...multi,
      relationships: [...multi.relationships, { from: { table: "fato_metas", column: "id_loja" }, to: { table: "dim_loja", column: "id_loja" } }],
    });
    const q = buildFilterOptionsQuery(reaching, all, "regiao", {});
    expect(q.sql.match(/GROUP BY dim_loja\.regiao/g)).toHaveLength(2);
    expect(q.sql).toContain("UNION ALL");
    expect(q.sql).toContain("FROM read_parquet('/data/metas.parquet') AS fato_metas");
  });

  it("tells a fact without a file apart from a broken query, and keeps the main fact's options", () => {
    expect(() => buildVisualQuery(multi, files, of("k_meta"), {})).toThrow(MissingFactError);
    expect(buildFilterOptionsQuery(multi, files, "regiao", {}).sql).not.toContain("UNION");
  });

  it("refuses a visual on a table that is not a fact, and a sameAs with other columns", () => {
    const bad = (patch: object) => templateSchema.safeParse({ ...multi, ...patch }).success;
    expect(bad({ visuals: [{ ...of("k_meta"), fact: "dim_loja" }] })).toBe(false);
    expect(bad({ tables: [...t.tables, { ...main, name: "outra", sameAs: main.name, columns: main.columns.slice(1) }], visuals: t.visuals })).toBe(false);
    expect(bad({})).toBe(true);
  });
});

describe("statement query", () => {
  const statement = templateSchema.parse({ ...t, visuals: [{
  id: "dre", type: "statement", title: "DRE", measure: "lucro", column: "mes", yearly: true, levels: ["categoria", "produto"], base: "liquida",
  lines: [
    { id: "bruta", label: "Bruta", icon: "receita", where: "dim_produto.categoria = 'A'" },
    { id: "custos", label: "Custos", where: "dim_produto.categoria = 'B'" },
    { id: "liquida", label: "Líquida", sum: ["bruta", "custos"] },
  ],
}] }).visuals[0] as QueryVisual;

  it("names each row's line by the first group line it matches and groups by levels and column", () => {
    const q = buildVisualQuery(t, files, statement, {});
    expect(q.sql).toContain("CASE WHEN (dim_produto.categoria = 'A') THEN 'bruta' WHEN (dim_produto.categoria = 'B') THEN 'custos' END AS statement_line");
    expect(q.sql).not.toContain("'liquida'");
    expect(q.sql).toMatch(/AS categoria, .* AS produto, .* AS mes, .* AS lucro/);
    expect(q.sql).toContain("GROUP BY 1, 2, 3, 4");
  });
});
