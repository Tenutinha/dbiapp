import { describe, expect, it } from "vitest";
import { buildSpaceGroups, type SetupInstance } from "./admin-setup";

const clients = [
  { id: "c1", name: "Cliente A", slug: "a" },
  { id: "c2", name: "Cliente B", slug: "b" },
];
const catalog = [
  {
    id: "mapa",
    name: "Mapa",
    tables: [
      { name: "f_votacao", kind: "fact" as const },
      { name: "d_municipio", kind: "dimension" as const },
      { name: "d_candidato", kind: "dimension" as const },
    ],
  },
  { id: "vendas", name: "Vendas", tables: [] },
];

function inst(over: Partial<SetupInstance>): SetupInstance {
  return {
    id: "i", name: "Mapa", templateId: "mapa", clientId: null,
    published: false, publishedAt: null, hasDraft: false, ...over,
  };
}

describe("buildSpaceGroups", () => {
  it("lists the organization first, then every client — even those without dashboards", () => {
    const groups = buildSpaceGroups([], clients, [], catalog);
    expect(groups.map((g) => g.scope)).toEqual(["org", "c1", "c2"]);
    expect(groups.map((g) => g.slug)).toEqual([null, "a", "b"]);
    expect(groups.every((g) => g.dashboards.length === 0)).toBe(true);
  });

  it("puts each linked dashboard under its space, keeping the given order", () => {
    const groups = buildSpaceGroups(
      [
        inst({ id: "1", templateId: "mapa", clientId: null }),
        inst({ id: "2", templateId: "vendas", name: "Vendas", clientId: "c2" }),
        inst({ id: "3", templateId: "mapa", clientId: "c2" }),
      ],
      clients,
      [],
      catalog,
    );
    expect(groups[0].dashboards.map((d) => d.instanceId)).toEqual(["1"]);
    expect(groups[1].dashboards).toEqual([]);
    expect(groups[2].dashboards.map((d) => d.instanceId)).toEqual(["2", "3"]);
  });

  it("offers only the catalog dashboards the space does not have yet", () => {
    const groups = buildSpaceGroups([inst({ id: "1", templateId: "mapa", clientId: "c1" })], clients, [], catalog);
    expect(groups[1].available.map((t) => t.id)).toEqual(["vendas"]);
    expect(groups[0].available.map((t) => t.id)).toEqual(["mapa", "vendas"]);
  });

  it("counts the files of each linked dashboard", () => {
    const [org] = buildSpaceGroups(
      [inst({ id: "1" })],
      clients,
      [
        { instanceId: "1", status: "active", tableName: "f_votacao" },
        { instanceId: "1", status: "active", tableName: "d_municipio" },
        { instanceId: "1", status: "draft", tableName: "d_municipio" },
      ],
      catalog,
    );
    expect(org.dashboards[0].files).toEqual({ active: 2, draft: 1 });
  });

  it("does not mutate its inputs", () => {
    expect(() =>
      buildSpaceGroups(Object.freeze([inst({ id: "1" })]), Object.freeze([...clients]), Object.freeze([]), Object.freeze([...catalog])),
    ).not.toThrow();
  });

  it("counts required fact and dimension tables against the ones with a file (published or waiting)", () => {
    const [org] = buildSpaceGroups(
      [inst({ id: "1" })],
      clients,
      [
        { instanceId: "1", status: "active", tableName: "f_votacao" },
        { instanceId: "1", status: "draft", tableName: "f_votacao" },
        { instanceId: "1", status: "draft", tableName: "d_municipio" },
        { instanceId: "1", status: "draft", tableName: "tabela_extra" },
      ],
      catalog,
    );
    expect(org.dashboards[0].tables).toEqual({
      fact: { required: 1, sent: 1 },
      dimension: { required: 2, sent: 1 },
    });
  });

  it("has no table count when the dashboard is not in the catalog", () => {
    const [org] = buildSpaceGroups([inst({ id: "1", templateId: "antigo" })], clients, [], catalog);
    expect(org.dashboards[0].tables).toBeNull();
  });
});
