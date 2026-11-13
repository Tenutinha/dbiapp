import { describe, expect, it } from "vitest";
import { chooseField, resolveTable, withChosenFields } from "./field-choice";
import type { Template, Visual } from "./schema";

type TableVisual = Extract<Visual, { type: "table" }>;

const table: TableVisual = {
  id: "t_produto", type: "table", title: "Análise", span: 12, limit: 500,
  fields: ["produto"], measures: ["estoque", "classificacao", "abc"], orderBy: "classificacao",
  fieldChoices: ["produto", "marca", "linha"],
  onlyWith: { classificacao: ["produto"], abc: ["produto"] },
};

describe("resolveTable", () => {
  it("keeps the table as it is without a choice", () => {
    expect(resolveTable(table, {})).toBe(table);
  });

  it("swaps the first field and leaves out the measures that need another one", () => {
    const t = resolveTable(table, { "d.t_produto": "marca" });
    expect(t.fields).toEqual(["marca"]);
    expect(t.measures).toEqual(["estoque"]);
    expect(t.orderBy).toBeUndefined();
  });

  it("ignores a field that is not one of the choices", () => {
    expect(resolveTable(table, { "d.t_produto": "cliente" }).fields).toEqual(["produto"]);
  });

  it("takes the first value when the param repeats", () => {
    expect(resolveTable(table, { "d.t_produto": ["linha", "marca"] }).fields).toEqual(["linha"]);
  });

  it("does not touch the input", () => {
    resolveTable(table, { "d.t_produto": "marca" });
    expect(table.fields).toEqual(["produto"]);
    expect(table.measures).toHaveLength(3);
  });
});

describe("withChosenFields", () => {
  const template = { visuals: [table, { id: "k", type: "kpi", title: "K", span: 3, measure: "estoque" }] } as unknown as Template;

  it("returns the same template when nothing is swappable", () => {
    const plain = { visuals: [{ id: "k", type: "kpi", title: "K", span: 3, measure: "estoque" }] } as unknown as Template;
    expect(withChosenFields(plain, { "d.k": "x" })).toBe(plain);
  });

  it("resolves only the tables", () => {
    const t = withChosenFields(template, { "d.t_produto": "linha" });
    expect((t.visuals[0] as TableVisual).fields).toEqual(["linha"]);
    expect(t.visuals[1]).toBe(template.visuals[1]);
  });
});

describe("chooseField", () => {
  it("sets the choice and drops what was picked in that table", () => {
    const params = new URLSearchParams("f.ano=2026&x.t_produto.produto=A&x.outro.marca=B");
    expect(chooseField(params, "t_produto", "marca").toString()).toBe("f.ano=2026&x.outro.marca=B&d.t_produto=marca");
  });

  it("replaces an earlier choice", () => {
    const params = new URLSearchParams("d.t_produto=marca");
    expect(chooseField(params, "t_produto", "linha").toString()).toBe("d.t_produto=linha");
  });
});
