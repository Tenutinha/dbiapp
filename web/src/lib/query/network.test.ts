import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema, type Template } from "../templates/schema";
import { buildVisualQuery, networkFields, type QueryVisual } from "./build";

const sales = loadTemplate("vendas-executivo");
const files = Object.fromEntries(sales.tables.map((tb) => [tb.name, `/data/${tb.name}.parquet`]));

/** The sales template with a network from each store's region to each customer segment (positions are stand-ins). */
const network = {
  id: "rede", title: "Rede", type: "network",
  source: { id: "loja", label: "loja", lat: "ano", lon: "mes", kind: "canal", detail: "regiao" },
  target: { id: "segmento", label: "segmento", lat: "ano", lon: "mes", kind: "categoria" },
  category: "canal", measure: "receita", tooltip: ["receita"],
};

function withNetwork(visual: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return templateSchema.safeParse({ ...sales, ...extra, visuals: [...sales.visuals, visual] });
}

describe("network visual", () => {
  it("is accepted with fill, and its defaults are set", () => {
    const parsed = withNetwork(network, { fill: true });
    expect(parsed.success).toBe(true);
    const v = (parsed.data as Template).visuals.find((x) => x.id === "rede");
    expect(v).toMatchObject({ type: "network", limit: 2000, span: 12 });
  });

  it("rejects unknown fields and measures, and both ends on the same field", () => {
    const bad = withNetwork({ ...network, target: { ...network.target, lat: "nada" }, measure: "nenhuma" });
    expect(bad.success).toBe(false);
    const messages = bad.error?.issues.map((i) => i.message).join(" ") ?? "";
    expect(messages).toContain('unknown field "nada"');
    expect(messages).toContain('unknown measure "nenhuma"');
    const same = withNetwork({ ...network, target: { ...network.target, id: "loja" } });
    expect(same.error?.issues.some((i) => i.message.includes("different fields"))).toBe(true);
  });

  it("groups by each field of both ends once and orders by the measure", () => {
    const t = templateSchema.parse({ ...sales, visuals: [...sales.visuals, network] });
    const v = t.visuals.find((x) => x.id === "rede") as QueryVisual;
    expect(networkFields(v as Extract<QueryVisual, { type: "network" }>)).toEqual(["loja", "ano", "mes", "canal", "regiao", "segmento", "categoria"]);
    const { sql } = buildVisualQuery(t, files, v, {});
    expect(sql).toMatch(/GROUP BY 1, 2, 3, 4, 5, 6, 7\n/);
    expect(sql).toMatch(/ORDER BY receita DESC NULLS LAST LIMIT 2000$/);
    expect(sql).toContain("LEFT JOIN");
  });

  it("with a timeline, the rows come per period too", () => {
    const t = templateSchema.parse({ ...sales, visuals: [...sales.visuals, { ...network, time: "produto", limit: 10000 }] });
    const v = t.visuals.find((x) => x.id === "rede") as Extract<QueryVisual, { type: "network" }>;
    expect(networkFields(v)).toContain("produto");
    expect(buildVisualQuery(t, files, v, {}).sql).toContain("GROUP BY 1, 2, 3, 4, 5, 6, 7, 8\n");
    expect(withNetwork({ ...network, time: "nada" }).success).toBe(false);
  });
});
