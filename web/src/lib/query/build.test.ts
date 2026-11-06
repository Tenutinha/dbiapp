import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { buildFilterOptionsQuery, buildVisualQuery, buildWhere } from "./build";

const t = loadTemplate("vendas-executivo");
const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `/data/${tb.name}.parquet`]));
const visual = (id: string) => t.visuals.find((v) => v.id === id)!;

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
  it("joins every dimension to the fact table", () => {
    const q = buildVisualQuery(t, files, visual("k_receita"), {});
    expect(q.sql).toContain("FROM read_parquet('/data/fato_vendas.parquet') AS fato_vendas");
    expect(q.sql).toContain("LEFT JOIN read_parquet('/data/dim_loja.parquet') AS dim_loja ON fato_vendas.id_loja = dim_loja.id_loja");
    expect(q.sql).not.toContain("GROUP BY");
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
