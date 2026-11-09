import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import {
  defaultVisual,
  emptyTemplate,
  moveAt,
  prepareForSave,
  removeAnalysis,
  removeAt,
  removeTable,
  removeVisual,
  replaceAt,
  toKebabId,
  toSnakeId,
  uniqueId,
  usedIds,
} from "./draft";
import { templateSchema } from "./schema";

const base = templateSchema.parse(loadTemplate("vendas-executivo"));

describe("ids from labels", () => {
  it("make snake_case identifiers without accents", () => {
    expect(toSnakeId("Receita por Canal")).toBe("receita_por_canal");
    expect(toSnakeId("  Força da vitória! ")).toBe("forca_da_vitoria");
    expect(toSnakeId("2º turno")).toBe("x2_turno");
    expect(toSnakeId("")).toBe("");
  });

  it("make kebab-case dashboard ids", () => {
    expect(toKebabId("Eleição Presidencial 2026")).toBe("eleicao-presidencial-2026");
  });

  it("avoid ids already taken", () => {
    expect(uniqueId("receita", ["receita", "receita_2"])).toBe("receita_3");
    expect(uniqueId("lucro", ["receita"])).toBe("lucro");
    expect(uniqueId("", [])).toBe("item");
  });
});

describe("list helpers never mutate", () => {
  const list = ["a", "b", "c"] as const;
  it("replace, remove and move by index", () => {
    expect(replaceAt(list, 1, "x")).toEqual(["a", "x", "c"]);
    expect(removeAt(list, 0)).toEqual(["b", "c"]);
    expect(moveAt(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveAt(list, 0, -1)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("removing items cleans references", () => {
  it("a removed visual leaves its analysis", () => {
    const t = { ...base, analyses: [{ id: "a", title: "A", description: "", visuals: ["k_receita", "k_margem"] }] };
    const next = removeVisual(t, "k_receita");
    expect(next.visuals.some((v) => v.id === "k_receita")).toBe(false);
    expect(next.analyses[0].visuals).toEqual(["k_margem"]);
    expect(t.analyses[0].visuals).toHaveLength(2);
  });

  it("a removed analysis leaves the summary, and empty groups go away", () => {
    const t = {
      ...base,
      analyses: [
        { id: "a", title: "A", description: "", visuals: [] },
        { id: "b", title: "B", description: "", visuals: [] },
      ],
      summary: [
        { title: "G1", analyses: ["a"] },
        { title: "G2", analyses: ["a", "b"] },
      ],
    };
    const next = removeAnalysis(t, "a");
    expect(next.analyses.map((a) => a.id)).toEqual(["b"]);
    expect(next.summary).toEqual([{ title: "G2", analyses: ["b"] }]);
  });

  it("a removed table takes its relationships along", () => {
    const next = removeTable(base, "dim_loja");
    expect(next.tables.some((t) => t.name === "dim_loja")).toBe(false);
    expect(next.relationships.some((r) => r.to.table === "dim_loja")).toBe(false);
  });
});

describe("new items", () => {
  it("default visuals of every type have the fields their type needs", () => {
    expect(defaultVisual("kpi", "k", "K")).toMatchObject({ type: "kpi", measure: "" });
    expect(defaultVisual("bar", "b", "B")).toMatchObject({ type: "bar", measures: [], sort: "field", limit: 100 });
    expect(defaultVisual("table", "t", "T")).toMatchObject({ type: "table", fields: [], measures: [], limit: 20 });
    expect(defaultVisual("map", "m", "M")).toMatchObject({ type: "map", geo: "uf", color: { mode: "scale" } });
    expect(defaultVisual("text", "x", "X")).toMatchObject({ type: "text", body: "" });
  });

  it("an empty dashboard starts with one fact file and no layout", () => {
    const t = emptyTemplate();
    expect(t.version).toBe(1);
    expect(t.tables).toHaveLength(1);
    expect(t.tables[0].kind).toBe("fact");
    expect(t.visuals).toEqual([]);
  });
});

describe("usedIds", () => {
  it("lists fields and measures referenced by visuals and filters", () => {
    const used = usedIds(base);
    expect(used.fields.has("canal")).toBe(true);
    expect(used.fields.has("ano")).toBe(true);
    expect(used.measures.has("receita")).toBe(true);
    expect(used.measures.has("desconto_pct")).toBe(false);
  });
});

describe("prepareForSave", () => {
  it("keeps version 1 when creating", () => {
    expect(prepareForSave(base, null).version).toBe(base.version);
  });

  it("bumps the version above the stored one when something changed", () => {
    const edited = { ...base, name: "Outro nome" };
    expect(prepareForSave(edited, base).version).toBe(base.version + 1);
  });

  it("keeps the version when nothing changed", () => {
    expect(prepareForSave(base, base).version).toBe(base.version);
  });

  it("trims texts and drops summary groups without analyses", () => {
    const t = { ...base, name: "  Vendas  ", summary: [{ title: "Vazio", analyses: [] }] };
    const out = prepareForSave(t, null);
    expect(out.name).toBe("Vendas");
    expect(out.summary).toEqual([]);
  });
});
