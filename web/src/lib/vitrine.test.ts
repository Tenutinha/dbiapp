import { describe, expect, it } from "vitest";
import { filterVitrine, orgsThatCanAdd, parseVitrineQuery, vitrineAreas, type VitrineItem } from "./vitrine";

const items: VitrineItem[] = [
  { id: "vendas", name: "Visão Executiva de Vendas", area: "Comercial", origin: "powerbi", description: "Receita e margem", tables: ["fato_vendas"] },
  { id: "estoque", name: "Giro de Estoque", area: "Operações", origin: "qlikview", description: "Cobertura por loja", tables: ["fato_estoque"] },
  { id: "funil", name: "Funil Comercial", area: "Comercial", origin: "qlikview", description: "Conversão", tables: ["fato_oportunidade"] },
];

describe("parseVitrineQuery", () => {
  it("keeps valid values and drops unknown origins", () => {
    expect(parseVitrineQuery({ q: "  venda ", area: "Comercial", origem: "excel" })).toEqual({ q: "venda", area: "Comercial", origin: undefined });
  });

  it("ignores array params and empty strings", () => {
    expect(parseVitrineQuery({ q: ["a", "b"], area: "", origem: "powerbi" })).toEqual({ q: undefined, area: undefined, origin: "powerbi" });
  });

  it("caps the search length", () => {
    expect(parseVitrineQuery({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("filterVitrine", () => {
  it("returns everything without filters", () => {
    expect(filterVitrine(items, {})).toHaveLength(3);
  });

  it("matches search ignoring case and accents, including table names", () => {
    expect(filterVitrine(items, { q: "OPERACOES" }).map((i) => i.id)).toEqual(["estoque"]);
    expect(filterVitrine(items, { q: "oportunidade" }).map((i) => i.id)).toEqual(["funil"]);
  });

  it("combines area and origin", () => {
    expect(filterVitrine(items, { area: "Comercial", origin: "qlikview" }).map((i) => i.id)).toEqual(["funil"]);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    filterVitrine(items, { q: "giro" });
    expect(items).toEqual(copy);
  });
});

describe("vitrineAreas", () => {
  it("lists distinct areas sorted in pt-BR", () => {
    expect(vitrineAreas(items)).toEqual(["Comercial", "Operações"]);
  });
});

describe("orgsThatCanAdd", () => {
  const orgs = [
    { id: "1", slug: "a", name: "A", orgRole: "admin" as const },
    { id: "2", slug: "b", name: "B", orgRole: "editor" as const },
    { id: "3", slug: "c", name: "C", orgRole: "analyst" as const },
    { id: "4", slug: "d", name: "D", orgRole: null },
  ];

  it("keeps only staff who manage data", () => {
    expect(orgsThatCanAdd(orgs, false).map((o) => o.slug)).toEqual(["a", "b"]);
  });

  it("lets the platform admin add to any organization", () => {
    expect(orgsThatCanAdd(orgs, true)).toHaveLength(4);
  });
});
