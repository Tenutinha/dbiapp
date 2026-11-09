import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";
import { analysisAnchor, buildSections, buildSummary } from "./sections";

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
