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

  describe("optional display features", () => {
    const m = sales.measures[0].id;
    const withVisual = (v: Record<string, unknown>) => ({ ...sales, visuals: [...sales.visuals, { id: "extra", title: "X", ...v }] });

    it("accepts a KPI detail line with a measure, a text or both", () => {
      for (const detail of [{ measure: m }, { text: "no mês" }, { measure: m, text: "guias" }]) {
        expect(templateSchema.safeParse(withVisual({ type: "kpi", measure: m, detail })).success).toBe(true);
      }
    });

    it("rejects an empty KPI detail and one that points to an unknown measure", () => {
      expect(templateSchema.safeParse(withVisual({ type: "kpi", measure: m, detail: {} })).success).toBe(false);
      const r = templateSchema.safeParse(withVisual({ type: "kpi", measure: m, detail: { measure: "nao_existe" } }));
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("nao_existe");
    });

    it("accepts value labels on bars and the inline filter layout", () => {
      const field = sales.fields[0].id;
      expect(templateSchema.safeParse(withVisual({ type: "bar", field, measures: [m], labels: true })).success).toBe(true);
      expect(templateSchema.safeParse({ ...sales, filterLayout: "inline" }).success).toBe(true);
      expect(templateSchema.safeParse({ ...sales, filterLayout: "sidebar" }).success).toBe(false);
    });
  });
});
