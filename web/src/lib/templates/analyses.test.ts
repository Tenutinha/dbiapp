import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { templateSchema } from "./schema";

/** Analyses (page sections grouping visuals) and the summary (sidebar groups of analyses). */
const base = loadTemplate("vendas-executivo");

const withSections = {
  ...base,
  analyses: [
    { id: "visao_geral", title: "Visão geral", description: "Os números do período.", visuals: ["k_receita", "k_margem"] },
    { id: "por_canal", title: "Por canal", visuals: ["receita_canal"] },
  ],
  summary: [{ title: "O resultado", analyses: ["visao_geral", "por_canal"] }],
};

const errorsOf = (raw: unknown): string[] => {
  const r = templateSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("analyses and summary", () => {
  it("are optional: templates without them stay valid and get empty lists", () => {
    const r = templateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.analyses).toEqual([]);
      expect(r.data.summary).toEqual([]);
    }
  });

  it("accept sections that group existing visuals and a summary that lists them", () => {
    const r = templateSchema.safeParse(withSections);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.analyses[1].description).toBe("");
  });

  it("reject an analysis pointing to an unknown visual", () => {
    const bad = { ...withSections, analyses: [{ id: "x", title: "X", visuals: ["nao_existe"] }], summary: [] };
    expect(errorsOf(bad)).toContain('analysis x: unknown visual "nao_existe"');
  });

  it("reject a visual placed in two analyses", () => {
    const bad = {
      ...withSections,
      analyses: [
        { id: "a", title: "A", visuals: ["k_receita"] },
        { id: "b", title: "B", visuals: ["k_receita"] },
      ],
      summary: [],
    };
    expect(errorsOf(bad)).toContain('visual "k_receita" is in more than one analysis');
  });

  it("reject repeated analysis ids", () => {
    const bad = {
      ...withSections,
      analyses: [
        { id: "a", title: "A", visuals: ["k_receita"] },
        { id: "a", title: "A2", visuals: ["k_margem"] },
      ],
      summary: [],
    };
    expect(errorsOf(bad)).toContain('analysis id "a" is repeated');
  });

  it("reject a summary item that is not an analysis, or listed twice", () => {
    const unknown = { ...withSections, summary: [{ title: "G", analyses: ["fantasma"] }] };
    expect(errorsOf(unknown)).toContain('summary "G": unknown analysis "fantasma"');

    const twice = {
      ...withSections,
      summary: [
        { title: "G1", analyses: ["visao_geral"] },
        { title: "G2", analyses: ["visao_geral"] },
      ],
    };
    expect(errorsOf(twice)).toContain('analysis "visao_geral" appears more than once in the summary');
  });
});
