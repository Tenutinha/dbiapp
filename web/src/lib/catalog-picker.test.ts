import { describe, expect, it } from "vitest";
import { areaHues, areasOf, filterPickerItems, groupByArea, toPickerItem, type PickerItem } from "./catalog-picker";
import type { Template } from "./templates/schema";

const template = {
  id: "mapa",
  version: 1,
  name: "Eleições por município",
  area: "Eleições",
  origin: "web",
  description: "Votos por cidade.",
  tables: [
    { name: "f_votacao", kind: "fact", description: "", columns: [{ name: "votos", type: "integer", required: true }] },
    { name: "d_municipio", kind: "dimension", description: "", key: "cd", columns: [{ name: "cd", type: "text", required: true }] },
  ],
  relationships: [],
  fields: [],
  measures: [{ id: "votos", label: "Votos", sql: "sum(votos)" }],
  filters: [],
  filterDefaults: {},
  visuals: [
    { id: "k1", title: "Votos", span: 1, type: "kpi", measure: "votos" },
    { id: "k2", title: "Abstenção", span: 1, type: "kpi", measure: "votos" },
    { id: "m1", title: "Mapa", span: 2, type: "map" },
    { id: "b1", title: "Ranking", span: 2, type: "bar" },
  ],
  analyses: [
    { id: "a1", title: "A força da vitória", description: "Onde o vencedor foi melhor.", visuals: ["m1", "b1"] },
    { id: "a2", title: "Comparecimento", description: "", visuals: ["k2"] },
  ],
  summary: [],
} as unknown as Template;

describe("toPickerItem", () => {
  it("keeps what the picker shows and nothing internal (no SQL)", () => {
    const item = toPickerItem(template);
    expect(item).toEqual({
      id: "mapa",
      name: "Eleições por município",
      area: "Eleições",
      origin: "web",
      description: "Votos por cidade.",
      tables: [
        { name: "f_votacao", kind: "fact" },
        { name: "d_municipio", kind: "dimension" },
      ],
      analyses: [
        { title: "A força da vitória", description: "Onde o vencedor foi melhor.", visuals: 2 },
        { title: "Comparecimento", description: "", visuals: 1 },
      ],
      visualKinds: { kpi: 2, map: 1, bar: 1 },
      visualCount: 4,
    });
    expect(JSON.stringify(item)).not.toContain("sum(");
  });
});

const items: PickerItem[] = [
  toPickerItem(template),
  { ...toPickerItem(template), id: "vendas", name: "Visão de Vendas", area: "Comercial", description: "Receita e margem.", analyses: [] },
  { ...toPickerItem(template), id: "dre", name: "DRE Gerencial", area: "Financeiro", description: "Resultado.", analyses: [] },
];

describe("filterPickerItems", () => {
  it("returns everything for an empty search", () => {
    expect(filterPickerItems(items, "", null).map((i) => i.id)).toEqual(["mapa", "vendas", "dre"]);
  });

  it("matches name, subject, description and analysis titles, ignoring case and accents", () => {
    expect(filterPickerItems(items, "eleicoes", null).map((i) => i.id)).toEqual(["mapa"]);
    expect(filterPickerItems(items, "COMERCIAL", null).map((i) => i.id)).toEqual(["vendas"]);
    expect(filterPickerItems(items, "margem", null).map((i) => i.id)).toEqual(["vendas"]);
    expect(filterPickerItems(items, "forca da vitoria", null).map((i) => i.id)).toEqual(["mapa"]);
  });

  it("needs every word to match somewhere", () => {
    expect(filterPickerItems(items, "vendas receita", null).map((i) => i.id)).toEqual(["vendas"]);
    expect(filterPickerItems(items, "vendas eleicoes", null)).toEqual([]);
  });

  it("narrows by subject", () => {
    expect(filterPickerItems(items, "", "Financeiro").map((i) => i.id)).toEqual(["dre"]);
  });
});

describe("areasOf / groupByArea", () => {
  it("lists subjects alphabetically and groups items under them", () => {
    expect(areasOf(items)).toEqual(["Comercial", "Eleições", "Financeiro"]);
    expect(groupByArea(items).map(([area, list]) => [area, list.map((i) => i.id)])).toEqual([
      ["Comercial", ["vendas"]],
      ["Eleições", ["mapa"]],
      ["Financeiro", ["dre"]],
    ]);
  });
});

describe("areaHues", () => {
  it("gives every subject a different colour", () => {
    const hues = areaHues(items);
    expect(new Set(hues.values()).size).toBe(3);
    expect(hues.get("Comercial")).not.toBe(hues.get("Eleições"));
  });
});
