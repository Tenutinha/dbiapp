import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";
import { analysisAnchor, buildOutline, buildSections, buildSummary, withoutHidden } from "./sections";

const base = templateSchema.parse(loadTemplate("vendas-executivo"));
const t = templateSchema.parse({
  ...base,
  analyses: [
    { id: "canais", title: "Canais", description: "Por onde vende.", visuals: ["receita_canal"] },
    { id: "visao", title: "Visão geral", visuals: ["k_margem", "k_receita"] },
    { id: "extra", title: "Fora do sumário", visuals: [] },
  ],
  summary: [
    { title: "O resultado", analyses: ["visao"] },
    { title: "Detalhes", analyses: ["canais"] },
  ],
});
const results = t.visuals.map((v) => ({ visual: v, rows: [] }));

describe("buildSections", () => {
  it("keeps the flat layout when there are no analyses", () => {
    const s = buildSections(base, results);
    expect(s.sections).toEqual([]);
    expect(s.loose.map((r) => r.visual.id)).toEqual(base.visuals.map((v) => v.id));
  });

  it("puts visuals outside every analysis first, then each analysis with its visuals in its own order", () => {
    const s = buildSections(t, results);
    expect(s.loose.map((r) => r.visual.id)).not.toContain("k_receita");
    expect(s.loose.map((r) => r.visual.id)).toContain("k_pedidos");
    expect(s.sections.map((x) => x.analysis.id)).toEqual(["canais", "visao", "extra"]);
    expect(s.sections[1].results.map((r) => r.visual.id)).toEqual(["k_margem", "k_receita"]);
  });

  it("numbers sections as the summary does; analyses outside the summary get no number", () => {
    const s = buildSections(t, results);
    expect(s.sections.map((x) => x.number)).toEqual([2, 1, null]);
  });
});

describe("buildSummary", () => {
  it("lists the summary groups with numbered links to each section", () => {
    expect(buildSummary(t)).toEqual([
      { title: "O resultado", items: [{ id: "visao", title: "Visão geral", number: 1, anchor: analysisAnchor("visao") }] },
      { title: "Detalhes", items: [{ id: "canais", title: "Canais", number: 2, anchor: analysisAnchor("canais") }] },
    ]);
  });

  it("is empty for dashboards without a summary", () => {
    expect(buildSummary(base)).toEqual([]);
  });
});

describe("buildOutline", () => {
  it("lists every analysis of the summary in reading order, without the groups", () => {
    expect(buildOutline(t).map((i) => [i.number, i.title])).toEqual([[1, "Visão geral"], [2, "Canais"]]);
  });

  it("is empty for dashboards without a summary", () => {
    expect(buildOutline(base)).toEqual([]);
  });
});

describe("hidden analyses (off the air)", () => {
  const off = { ...t, analyses: t.analyses.map((a) => (a.id === "visao" ? { ...a, hidden: true } : a)) };

  it("leave the summary, and the numbering skips them", () => {
    expect(buildOutline(off).map((i) => [i.id, i.number])).toEqual([["canais", 1]]);
  });

  it("leave the page and the computed visuals for readers", () => {
    const reader = withoutHidden(off);
    expect(reader.analyses.map((a) => a.id)).toEqual(["canais", "extra"]);
    expect(reader.visuals.some((v) => v.id === "k_margem" || v.id === "k_receita")).toBe(false);
    expect(reader.summary).toEqual([{ title: "Detalhes", analyses: ["canais"] }]);
    expect(buildSections(reader, []).sections.map((s) => s.analysis.id)).toEqual(["canais", "extra"]);
  });

  it("change nothing when no analysis is hidden", () => {
    expect(withoutHidden(t)).toBe(t);
  });
});
