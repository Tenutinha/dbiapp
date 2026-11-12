import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";
import { analysisUsage, buildStructure, looseVisuals, tablesIn } from "./structure";

const base = templateSchema.parse(loadTemplate("vendas-executivo"));
const t = templateSchema.parse({
  ...base,
  analyses: [
    { id: "canais", title: "Canais", visuals: ["receita_canal"] },
    { id: "visao", title: "Visão geral", visuals: ["k_margem", "k_receita"] },
    { id: "extra", title: "Fora do sumário", visuals: [] },
  ],
  summary: [
    { title: "O resultado", analyses: ["visao"] },
    { title: "Detalhes", analyses: ["canais"] },
  ],
});

describe("tablesIn", () => {
  it("finds the template's tables an expression mentions", () => {
    expect(tablesIn("SUM(fato_vendas.receita) / NULLIF(dim_x.y, 0)", ["fato_vendas", "dim_x", "outra"])).toEqual(["fato_vendas", "dim_x"]);
    expect(tablesIn("COUNT(*)", ["fato_vendas"])).toEqual([]);
  });
});

describe("buildStructure", () => {
  it("lists topics in summary order, then the analyses the summary leaves out", () => {
    const groups = buildStructure(t);
    expect(groups.map((g) => g.title)).toEqual(["O resultado", "Detalhes", null]);
    expect(groups.map((g) => g.rows.map((r) => [r.analysis.id, r.number]))).toEqual([[["visao", 1]], [["canais", 2]], [["extra", null]]]);
  });

  it("skips hidden analyses in the numbering", () => {
    const off = { ...t, analyses: t.analyses.map((a) => (a.id === "visao" ? { ...a, hidden: true } : a)) };
    expect(buildStructure(off).flatMap((g) => g.rows.map((r) => r.number))).toEqual([null, 1, null]);
  });
});

describe("analysisUsage", () => {
  it("collects charts, their fields and measures, and the files they read", () => {
    const visao = t.analyses.find((a) => a.id === "visao")!;
    const usage = analysisUsage(t, visao);
    expect(usage.visuals.map((v) => v.id)).toEqual(["k_margem", "k_receita"]);
    expect(usage.used.every((u) => u.kind === "measure")).toBe(true);
    expect(usage.tables.length).toBeGreaterThan(0);
    expect(usage.tables.every((tb) => t.tables.some((x) => x.name === tb))).toBe(true);
  });

  it("is empty for an analysis without charts", () => {
    const extra = t.analyses.find((a) => a.id === "extra")!;
    expect(analysisUsage(t, extra)).toEqual({ tables: [], visuals: [], used: [] });
  });
});

describe("looseVisuals", () => {
  it("lists the charts outside every analysis", () => {
    const placed = new Set(t.analyses.flatMap((a) => a.visuals));
    expect(looseVisuals(t).every((v) => !placed.has(v.id))).toBe(true);
    expect(looseVisuals(t).length).toBe(t.visuals.length - placed.size);
  });
});
