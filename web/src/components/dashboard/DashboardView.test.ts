import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadTemplate } from "@/lib/test-helpers";
import type { DashboardData } from "@/lib/query/run";
import { templateSchema } from "@/lib/templates/schema";
import { analysisAnchor } from "@/lib/templates/sections";
import { DashboardView } from "./DashboardView";

vi.mock("next/navigation", () => ({
  usePathname: () => "/org/d/1",
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const base = templateSchema.parse(loadTemplate("vendas-executivo"));
/** Only KPIs and a text block: they render without charts. */
const kpis = base.visuals.filter((v) => v.type === "kpi");
const note = { id: "nota", type: "text" as const, title: "Como ler", span: 12, body: "Primeiro parágrafo.\n\nSegundo." };

const template = templateSchema.parse({
  ...base,
  visuals: [...kpis, note],
  analyses: [{ id: "visao_geral", title: "Visão geral", description: "Os números do período.", visuals: ["k_margem", "nota"] }],
  summary: [{ title: "O resultado", analyses: ["visao_geral"] }],
});

const data: DashboardData = {
  visuals: template.visuals.map((visual) => ({ visual, rows: [{ receita: 1000, margem: 0.3, ticket_medio: 50, pedidos: 20 }] })),
  filters: [],
  cross: [],
  elapsedMs: 12,
};

const render = (t = template): string => renderToStaticMarkup(createElement(DashboardView, { template: t, data, totalRows: 10 }));

describe("DashboardView with analyses", () => {
  it("renders each analysis as an anchored section with number, title and description", () => {
    const html = render();
    expect(html).toContain(`id="${analysisAnchor("visao_geral")}"`);
    expect(html).toContain(">01<");
    expect(html).toContain("Visão geral");
    expect(html).toContain("Os números do período.");
  });

  it("shows loose visuals before the sections and section visuals inside them", () => {
    const html = render();
    const section = html.indexOf(`id="${analysisAnchor("visao_geral")}"`);
    expect(html.indexOf("Receita")).toBeLessThan(section); // k_receita is outside every analysis
    expect(html.indexOf("Como ler")).toBeGreaterThan(section);
    expect(html.indexOf("Segundo.")).toBeGreaterThan(section);
  });

  it("keeps the flat layout for dashboards without analyses", () => {
    const flat = templateSchema.parse({ ...template, analyses: [], summary: [] });
    const html = render(flat);
    expect(html).not.toContain('id="analise-');
    expect(html).toContain("Como ler");
  });
});
