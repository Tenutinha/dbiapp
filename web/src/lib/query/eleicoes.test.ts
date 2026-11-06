import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "../templates/schema";
import { buildVisualQuery, type QueryVisual } from "./build";
import { parseSelection } from "./run";

const t = loadTemplate("eleicoes-presidente");
const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `/data/${tb.name}.parquet`]));
const visual = (id: string) => t.visuals.find((v) => v.id === id)! as QueryVisual;

describe("eleicoes-presidente template", () => {
  it("is a web dashboard with maps and text", () => {
    expect(t.origin).toBe("web");
    expect(t.visuals.some((v) => v.type === "map")).toBe(true);
    expect(t.visuals.some((v) => v.type === "text")).toBe(true);
  });
});

describe("map visuals", () => {
  it("group by the IBGE code and label, select every colour measure once and allow all municipalities", () => {
    const q = buildVisualQuery(t, files, visual("mapa_t2"), { ano: ["2026"] });
    expect(q.sql).toMatch(/AS cd_municipio, .* AS municipio, /);
    expect(q.sql).toContain("AS vencedor_t2");
    expect(q.sql).toContain("AS cor_vencedor_t2");
    expect(q.sql.match(/AS pct_vencedor_t2/g)).toHaveLength(1); // also listed in tooltip
    expect(q.sql).toMatch(/GROUP BY 1, 2\nLIMIT 6000$/);
    expect(q.params).toEqual(["2026"]);
  });
});

describe("table orderBy", () => {
  it("sorts by the chosen measure instead of the first", () => {
    const q = buildVisualQuery(t, files, visual("tabela_maiores"), {});
    expect(q.sql).toContain("ORDER BY aptos_t2 DESC NULLS LAST LIMIT 30");
  });
});

describe("filterDefaults", () => {
  it("always selects exactly one election, falling back to the default", () => {
    expect(parseSelection(t, {}).ano).toEqual(["2026"]);
    expect(parseSelection(t, { "f.ano": ["2022", "2026"] }).ano).toEqual(["2022"]);
    expect(parseSelection(t, { "f.uf": "SP" })).toEqual({ ano: ["2026"], uf: ["SP"] });
  });
});

describe("schema rules for the new visuals", () => {
  it("rejects a map pointing to an unknown colour measure", () => {
    const visuals = t.visuals.map((v) =>
      v.type === "map" && v.color.mode === "category" ? { ...v, color: { ...v.color, colorMeasure: "nada" } } : v,
    );
    expect(JSON.stringify(templateSchema.safeParse({ ...t, visuals }).error?.issues)).toContain("nada");
  });

  it("rejects a default for something that is not a filter", () => {
    expect(templateSchema.safeParse({ ...t, filterDefaults: { municipio: "X" } }).success).toBe(false);
  });

  it("rejects a table orderBy outside its measures", () => {
    const visuals = t.visuals.map((v) => (v.type === "table" ? { ...v, orderBy: "aptos_t1" } : v));
    expect(templateSchema.safeParse({ ...t, visuals }).success).toBe(false);
  });

  it("accepts accented letters but still rejects statement separators", () => {
    const ok = { ...t, measures: [...t.measures, { id: "x", label: "X", sql: "CASE WHEN 1 = 1 THEN 'Não' END", format: "text" }] };
    expect(templateSchema.safeParse(ok).success).toBe(true);
    const bad = { ...t, measures: [...t.measures, { id: "x", label: "X", sql: "'Não'; DROP TABLE users", format: "text" }] };
    expect(templateSchema.safeParse(bad).success).toBe(false);
  });
});
