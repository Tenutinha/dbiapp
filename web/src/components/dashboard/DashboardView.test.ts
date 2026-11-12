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

// The server action behind an analysis left for later reaches the database; here it never runs.
vi.mock("./section-actions", () => ({ loadAnalysisAction: async () => ({ ok: false }) }));

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

  it("shows an analysis left for later with its title and a skeleton, without its visuals", () => {
    const later = { pending: ["visao_geral"], ticket: "t", search: "f.ano=2025" };
    const opening = { ...data, visuals: data.visuals.filter((v) => v.visual.id !== "k_margem" && v.visual.id !== "nota") };
    const html = renderToStaticMarkup(createElement(DashboardView, { template, data: opening, totalRows: 10, later }));
    const section = html.indexOf(`id="${analysisAnchor("visao_geral")}"`);
    expect(section).toBeGreaterThan(-1);
    expect(html).toContain("Os números do período.");
    expect(html).toContain("Carregando a análise");
    expect(html).not.toContain("Como ler");
    expect(html).toContain("as demais análises carregam ao chegar nelas");
    // What was computed with the page is there as always.
    expect(html.indexOf("Receita")).toBeLessThan(section);
  });

  it("shows a table's leading measures first and keeps them out of the totals line", () => {
    const table = {
      id: "t", type: "table" as const, title: "Por canal", span: 12, limit: 20, fields: ["canal"], measures: ["receita", "pedidos"],
      leading: ["pedidos"], total: true,
    };
    const t2 = templateSchema.parse({ ...template, visuals: [...template.visuals, table], analyses: [], summary: [] });
    const result = { visual: t2.visuals.at(-1)!, rows: [{ canal: "Loja", receita: 1000, pedidos: 20 }], total: { receita: 1000, pedidos: 20 } };
    const html = renderToStaticMarkup(createElement(DashboardView, {
      template: t2, data: { ...data, visuals: [...data.visuals, result] }, totalRows: 10,
    }));
    const head = html.slice(html.indexOf("Por canal"));
    expect(head.indexOf("Pedidos")).toBeLessThan(head.indexOf("Canal"));
    const foot = head.slice(head.indexOf("<tfoot"), head.indexOf("</tfoot>"));
    expect(foot).toContain("Total");
    expect(foot).not.toContain(">20<");
  });

  it("keeps the flat layout for dashboards without analyses", () => {
    const flat = templateSchema.parse({ ...template, analyses: [], summary: [] });
    const html = render(flat);
    expect(html).not.toContain('id="analise-');
    expect(html).toContain("Como ler");
  });
});

describe("DashboardView with pages turned sideways", () => {
  const twoPages = templateSchema.parse({
    ...template,
    paging: "horizontal",
    analyses: [
      { id: "visao_geral", title: "Visão geral", visuals: ["k_margem"] },
      { id: "nota_pagina", title: "Notas", visuals: ["nota"] },
    ],
    summary: [{ title: "Visão geral", analyses: ["visao_geral"] }, { title: "Notas", analyses: ["nota_pagina"] }],
  });

  it("keeps the option when the template is parsed", () => {
    expect(twoPages.paging).toBe("horizontal");
    expect(template.paging).toBeUndefined();
  });

  it("puts every analysis as a page of one strip, with a tab for each", () => {
    const html = render(twoPages);
    expect(html).toContain('aria-label="Páginas do dashboard"');
    expect(html).toContain("snap-x");
    const strip = html.indexOf("snap-x");
    expect(html.indexOf(`id="${analysisAnchor("visao_geral")}"`)).toBeGreaterThan(strip);
    expect(html.indexOf(`id="${analysisAnchor("nota_pagina")}"`)).toBeGreaterThan(strip);
    expect(html.match(/snap-start snap-always/g)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
  });

  it("keeps sections one below the other by default", () => {
    const html = render();
    expect(html).not.toContain("Páginas do dashboard");
    expect(html).toContain("mt-14 scroll-mt-24 first:mt-0");
  });
});

describe("DashboardView with the descriptions in the summary", () => {
  it("leaves each analysis's description out of the page and keeps its title", () => {
    const html = renderToStaticMarkup(createElement(DashboardView, { template, data, totalRows: 10, notesInSummary: true }));
    expect(html).toContain("Visão geral");
    expect(html).not.toContain("Os números do período.");
  });

  it("shows the descriptions on the page by default", () => {
    expect(render()).toContain("Os números do período.");
  });
});
