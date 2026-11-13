import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";

const sales = loadTemplate("vendas-executivo");

describe("templateSchema", () => {
  it("accepts the shipped sales template", () => {
    expect(sales.tables.filter((t) => t.kind === "fact")).toHaveLength(1);
    expect(sales.visuals.length).toBeGreaterThan(0);
  });

  it("rejects a visual that points to an unknown measure", () => {
    const broken = {
      ...sales,
      visuals: [{ id: "x", type: "kpi", title: "X", measure: "does_not_exist" }],
    };
    const result = templateSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("does_not_exist");
  });

  it.each([
    "SUM(x); DROP TABLE users",
    "SUM(x) -- comment",
    "(SELECT * FROM read_csv('/etc/passwd'))",
    "SUM(x) /* hidden */",
  ])("rejects unsafe measure SQL: %s", (expr) => {
    const broken = { ...sales, measures: [{ ...sales.measures[0], sql: expr }] };
    expect(templateSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a dimension whose key column is optional", () => {
    const tables = sales.tables.map((t) =>
      t.name === "dim_loja" ? { ...t, columns: t.columns.map((c) => ({ ...c, required: c.name !== "id_loja" })) } : t,
    );
    expect(templateSchema.safeParse({ ...sales, tables }).success).toBe(false);
  });

  it("rejects a dimension without key", () => {
    const tables = sales.tables.map((t) => (t.kind === "dimension" ? { ...t, key: undefined } : t));
    expect(templateSchema.safeParse({ ...sales, tables }).success).toBe(false);
  });
});

describe("statement visual", () => {
  const statement = {
  id: "dre", type: "statement", title: "DRE", measure: "lucro", column: "mes", yearly: true, levels: ["categoria", "produto"], base: "liquida",
  lines: [
    { id: "bruta", label: "Bruta", icon: "receita", where: "dim_produto.categoria = 'A'" },
    { id: "custos", label: "Custos", where: "dim_produto.categoria = 'B'" },
    { id: "liquida", label: "Líquida", sum: ["bruta", "custos"] },
  ],
};
  const parse = (v: object) => templateSchema.safeParse({ ...sales, visuals: [v] });
  const issues = (v: object): string => JSON.stringify(parse(v).error?.issues ?? []);

  it("accepts lines that are groups or sums of earlier lines", () => {
    expect(parse(statement).success).toBe(true);
  });

  it("rejects a line with both where and sum, or neither", () => {
    const both = { ...statement, lines: [{ ...statement.lines[0], sum: ["custos"] }, ...statement.lines.slice(1)] };
    expect(issues(both)).toContain("needs either where or sum");
    const neither = { ...statement, lines: [{ id: "x", label: "X" }] , base: undefined };
    expect(issues(neither)).toContain("needs either where or sum");
  });

  it("rejects a sum of a later or unknown line, an unknown base and unknown references", () => {
    const later = { ...statement, lines: [statement.lines[2], statement.lines[0], statement.lines[1]] };
    expect(issues(later)).toContain("not an earlier line");
    expect(issues({ ...statement, base: "nada" })).toContain("base");
    expect(issues({ ...statement, levels: ["nao_existe"] })).toContain("nao_existe");
    expect(issues({ ...statement, measure: "nao_existe" })).toContain("nao_existe");
  });

  it("rejects unsafe SQL in a line", () => {
    const unsafe = { ...statement, lines: [{ id: "x", label: "X", where: "1 = 1; DROP TABLE t" }], base: undefined };
    expect(parse(unsafe).success).toBe(false);
  });
});
