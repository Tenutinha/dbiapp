import { describe, expect, it } from "vitest";
import { boundsOf, buildNetwork, neighbourhood, toNumber } from "./network-graph";
import type { NetworkVisual } from "./templates/schema";

const visual: NetworkVisual = {
  id: "rede", title: "Rede", span: 12, type: "network", limit: 2000, tooltip: [],
  source: { id: "o_id", label: "o_nome", lat: "o_lat", lon: "o_lon", kind: "o_tipo", detail: "o_cidade" },
  target: { id: "d_id", label: "d_nome", lat: "d_lat", lon: "d_lon", kind: "d_tipo" },
  category: "tipo", measure: "valor",
};

const row = (o: string, d: string, tipo: string, valor: number, extra: Record<string, string> = {}) => ({
  o_id: o, o_nome: `Local ${o}`, o_lat: "-25.4", o_lon: "-49.3", o_tipo: o.startsWith("F") ? "Fornecedor" : "Filial", o_cidade: "Curitiba - PR",
  d_id: d, d_nome: `Local ${d}`, d_lat: "-23.5", d_lon: "-46.6", d_tipo: "Filial",
  tipo, valor, ...extra,
});

describe("buildNetwork", () => {
  it("adds up what leaves and reaches each place and lists its partners, the largest first", () => {
    const g = buildNetwork(visual, [row("F1", "L1", "Abastecimento", 100), row("F1", "L2", "Abastecimento", 300), row("L1", "L2", "Transferência", 50)]);
    const f1 = g.nodes.find((n) => n.id === "F1");
    expect(f1).toMatchObject({ out: 400, in: 0, kind: "Fornecedor", detail: "Curitiba - PR", lat: -25.4, lon: -49.3 });
    expect(f1?.partners.map((p) => p.id)).toEqual(["L2", "L1"]);
    expect(g.nodes.find((n) => n.id === "L2")).toMatchObject({ in: 350, out: 0 });
    expect(g.categories).toEqual(["Abastecimento", "Transferência"]);
    expect(g.kinds[0]).toBe("Filial");
    expect(g.edges).toHaveLength(3);
  });

  it("leaves out rows whose places have no valid coordinates", () => {
    const g = buildNetwork(visual, [row("F1", "L1", "A", 10, { o_lat: "" }), row("F2", "L1", "A", 10, { d_lon: "999" }), row("F3", "L1", "A", 5)]);
    expect(g.skipped).toBe(2);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["F3", "L1"]);
  });

  it("treats negative or missing values as zero", () => {
    const g = buildNetwork(visual, [row("F1", "L1", "A", -10)]);
    expect(g.edges[0].value).toBe(0);
  });
});

describe("helpers", () => {
  it("reads numbers written with a comma", () => {
    expect(toNumber("-25,43")).toBe(-25.43);
    expect(toNumber("x")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("lights a place's neighbours and arcs", () => {
    const g = buildNetwork(visual, [row("F1", "L1", "A", 1), row("L2", "L3", "A", 1)]);
    const n = neighbourhood(g, "L1");
    expect([...n.nodes].sort()).toEqual(["F1", "L1"]);
    expect(n.edges.size).toBe(1);
  });

  it("pads the bounds of the places", () => {
    expect(boundsOf([])).toBeNull();
    const [[w, s], [e, n]] = boundsOf([{ lon: -50, lat: -25 }, { lon: -40, lat: -20 }]) ?? [[0, 0], [0, 0]];
    expect(w).toBeLessThan(-50);
    expect(e).toBeGreaterThan(-40);
    expect(s).toBeLessThan(-25);
    expect(n).toBeGreaterThan(-20);
  });
});
