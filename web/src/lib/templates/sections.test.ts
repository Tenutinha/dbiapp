import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";
import { analysisAnchor, buildOutline, buildSections, buildSummary, offTheAir, openingVisuals, withoutHidden } from "./sections";

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

describe("openingVisuals", () => {
  it("computes the loose visuals and the first analysis with the page, and leaves the others for later", () => {
    const opening = openingVisuals(t);
    // "canais" is the first analysis of the page; "visao" and "extra" wait.
    expect(opening.pending).toEqual(["visao", "extra"]);
    expect(opening.only.has("receita_canal")).toBe(true);
    expect(opening.only.has("k_margem")).toBe(false);
    const placed = new Set(t.analyses.flatMap((a) => a.visuals));
    const loose = t.visuals.filter((v) => !placed.has(v.id)).map((v) => v.id);
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.every((id) => opening.only.has(id))).toBe(true);
  });

  it("leaves nothing for later on a dashboard without analyses", () => {
    const opening = openingVisuals(base);
    expect(opening.pending).toEqual([]);
    expect(opening.only.size).toBe(base.visuals.length);
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
    expect(reader.analyses.map((a) => a.id)).toEqual(["canais"]);
    expect(reader.visuals.some((v) => v.id === "k_margem" || v.id === "k_receita")).toBe(false);
    expect(reader.summary).toEqual([{ title: "Detalhes", analyses: ["canais"] }]);
    expect(buildSections(reader, []).sections.map((s) => s.analysis.id)).toEqual(["canais"]);
  });

  it("include the analyses left out of the summary, with their charts", () => {
    const withChart = { ...t, analyses: t.analyses.map((a) => (a.id === "extra" ? { ...a, visuals: ["k_margem"] } : a.id === "visao" ? { ...a, visuals: ["k_receita"] } : a)) };
    expect([...offTheAir(withChart)]).toEqual(["extra"]);
    const reader = withoutHidden(withChart);
    expect(reader.analyses.map((a) => a.id)).toEqual(["canais", "visao"]);
    expect(reader.visuals.some((v) => v.id === "k_margem")).toBe(false);
  });

  it("change nothing when every analysis is in the summary, or there is no summary at all", () => {
    const allListed = { ...t, analyses: t.analyses.filter((a) => a.id !== "extra") };
    expect(withoutHidden(allListed)).toBe(allListed);
    const noSummary = { ...t, summary: [] };
    expect(withoutHidden(noSummary)).toBe(noSummary);
  });
});
