import { describe, expect, it } from "vitest";
import { buildToc, firstItem, nextItem, LayoutError, layoutDraftSchema, planLayout, type DashboardRow, type SectionRow } from "./toc";

const ids = {
  s1: "00000000-0000-4000-8000-000000000001",
  s2: "00000000-0000-4000-8000-000000000002",
  a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b",
  c: "00000000-0000-4000-8000-00000000000c",
  d: "00000000-0000-4000-8000-00000000000d",
};

const dash = (id: string, name: string, sectionId: string | null, position: number, published = true): DashboardRow => ({
  id, name, description: null, sectionId, position, templateId: "t", published, publishedAt: null,
});

const sections: SectionRow[] = [
  { id: ids.s2, title: "Financeiro", position: 2 },
  { id: ids.s1, title: "Comercial", position: 1 },
];
const dashboards = [
  dash(ids.c, "DRE", ids.s2, 3),
  dash(ids.a, "Visão geral", null, 1),
  dash(ids.b, "Vendas", ids.s1, 2),
  dash(ids.d, "Fluxo de caixa", ids.s2, 4, false),
];

describe("buildToc", () => {
  it("puts unsectioned first, then sections in order, numbering continuously", () => {
    const toc = buildToc(sections, dashboards, { includeUnpublished: false, includeEmptySections: false });
    expect(toc.map((g) => g.section?.title ?? null)).toEqual([null, "Comercial", "Financeiro"]);
    expect(toc.flatMap((g) => g.items.map((i) => `${i.number}:${i.name}`))).toEqual(["1:Visão geral", "2:Vendas", "3:DRE"]);
  });

  it("shows unpublished dashboards only to managers", () => {
    const toc = buildToc(sections, dashboards, { includeUnpublished: true, includeEmptySections: false });
    expect(toc.at(-1)?.items.map((i) => i.name)).toEqual(["DRE", "Fluxo de caixa"]);
  });

  it("hides empty sections from readers but shows them while editing", () => {
    const empty: SectionRow[] = [...sections, { id: "00000000-0000-4000-8000-000000000003", title: "RH", position: 3 }];
    expect(buildToc(empty, dashboards, { includeUnpublished: false, includeEmptySections: false }).map((g) => g.section?.title))
      .not.toContain("RH");
    expect(buildToc(empty, dashboards, { includeUnpublished: false, includeEmptySections: true }).map((g) => g.section?.title))
      .toContain("RH");
  });

  it("treats a dashboard pointing to a deleted section as unsectioned", () => {
    const toc = buildToc([], [dash(ids.a, "X", ids.s1, 1)], { includeUnpublished: false, includeEmptySections: false });
    expect(toc).toHaveLength(1);
    expect(toc[0].section).toBeNull();
  });

  it("firstItem skips dashboards without data", () => {
    const toc = buildToc([], [dash(ids.a, "A", null, 1, false), dash(ids.b, "B", null, 2)], {
      includeUnpublished: true, includeEmptySections: false,
    });
    expect(firstItem(toc)?.name).toBe("B");
  });
});

describe("planLayout", () => {
  const existing = { sectionIds: [ids.s1, ids.s2], dashboardIds: [ids.a, ids.b, ids.c] };

  it("plans positions, new sections, deletions and renames", () => {
    const plan = planLayout(
      {
        ungrouped: [ids.b],
        sections: [{ id: null, title: "Novos", items: [ids.c] }, { id: ids.s1, title: "Comercial", items: [ids.a] }],
        dashboards: [{ id: ids.a, name: "Painel A", description: "" }],
      },
      existing,
    );
    expect(plan.sections).toEqual([
      { id: null, title: "Novos", position: 1 },
      { id: ids.s1, title: "Comercial", position: 2 },
    ]);
    expect(plan.deleteSectionIds).toEqual([ids.s2]);
    expect(plan.placements).toEqual([
      { dashboardId: ids.b, sectionIndex: null, position: 1 },
      { dashboardId: ids.c, sectionIndex: 0, position: 2 },
      { dashboardId: ids.a, sectionIndex: 1, position: 3 },
    ]);
    expect(plan.renames).toEqual([{ id: ids.a, name: "Painel A", description: null }]);
  });

  it("keeps dashboards the draft forgot, appended without section", () => {
    const plan = planLayout({ ungrouped: [ids.a], sections: [], dashboards: [] }, existing);
    expect(plan.placements.map((p) => p.dashboardId)).toEqual([ids.a, ids.b, ids.c]);
  });

  it.each([
    ["unknown dashboard", { ungrouped: [ids.d], sections: [], dashboards: [] }],
    ["duplicate dashboard", { ungrouped: [ids.a, ids.a], sections: [], dashboards: [] }],
    ["foreign section", { ungrouped: [], sections: [{ id: ids.d, title: "X", items: [] }], dashboards: [] }],
    ["rename of a foreign dashboard", { ungrouped: [], sections: [], dashboards: [{ id: ids.d, name: "X", description: "" }] }],
  ])("rejects %s", (_label, draft) => {
    expect(() => planLayout(draft, existing)).toThrow(LayoutError);
  });

  it("schema rejects blank titles and oversized descriptions", () => {
    expect(layoutDraftSchema.safeParse({ ungrouped: [], sections: [{ id: null, title: "  ", items: [] }], dashboards: [] }).success)
      .toBe(false);
    expect(layoutDraftSchema.safeParse({
      ungrouped: [], sections: [], dashboards: [{ id: ids.a, name: "A", description: "x".repeat(281) }],
    }).success).toBe(false);
  });
});

describe("nextItem", () => {
  const toc = buildToc(sections, dashboards, { includeUnpublished: false, includeEmptySections: false });

  it("follows the reading order across sections", () => {
    expect(nextItem(toc, ids.a)?.id).toBe(ids.b);
    expect(nextItem(toc, ids.b)?.id).toBe(ids.c);
  });

  it("is null after the last dashboard and for one that is not listed", () => {
    expect(nextItem(toc, ids.c)).toBeNull();
    expect(nextItem(toc, ids.d)).toBeNull();
  });
});
