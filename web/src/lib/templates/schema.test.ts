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
