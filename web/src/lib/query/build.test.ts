import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { buildFilterOptionsQuery, buildVisualQuery, buildWhere, type QueryVisual } from "./build";

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

  it("adds the visual's own condition to the screen filters, and can skip some of them", () => {
    const own = { ...visual("k_receita"), where: "fato_vendas.quantidade > 1" };
    expect(buildVisualQuery(t, files, own, {}).sql).toContain("WHERE (fato_vendas.quantidade > 1)");
    const both = buildVisualQuery(t, files, own, { ano: ["2025"] });
    expect(both.sql).toMatch(/WHERE .* IN \(\$1\) AND \(fato_vendas\.quantidade > 1\)/);
    const skipped = buildVisualQuery(t, files, { ...own, skipFilters: ["ano"] }, { ano: ["2025"] });
    expect(skipped.params).toEqual([]);
    expect(skipped.sql).not.toContain("$1");
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
    expect(q.sql).toContain("SELECT DISTINCT COALESCE(");
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

