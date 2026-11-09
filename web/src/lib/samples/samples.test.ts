import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toDuckPath } from "../duck/engine";
import { runDashboard } from "../query/run";
import { templateSchema, type Template } from "../templates/schema";
import { loadTemplate } from "../test-helpers";
import { literalDomains } from "./domains";
import { ensureSampleFiles, sampleAnchor } from "./files";
import { buildSamplePlan } from "./plan";

const NOW = new Date(Date.UTC(2026, 10, 9));
const BUILT_IN = ["vendas-executivo", "eleicoes-presidente"];
/** Extra template JSON files (the molds kept outside the repo), separated by `;`. */
const EXTRA = (process.env.DBI_SAMPLE_TEMPLATES ?? "").split(";").filter(Boolean);

const tempRoot = async (): Promise<string> => toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-samples-")));

async function expectExplorable(template: Template): Promise<void> {
  const root = await tempRoot();
  const sample = await ensureSampleFiles(root, template, NOW);
  expect(Object.keys(sample.files).sort()).toEqual(template.tables.map((t) => t.name).sort());

  const data = await runDashboard(root, template, { ...sample.files }, {});
  const failed = data.visuals.filter((v) => v.error).map((v) => `${v.visual.id}: ${v.error}`);
  expect(failed).toEqual([]);
  const empty = data.visuals.filter((v) => v.visual.type !== "text" && v.rows.length === 0).map((v) => v.visual.id);
  expect(empty).toEqual([]);
  const blank = data.visuals
    .filter((v) => v.rows.length > 0 && v.rows.every((row) => Object.values(row).every((value) => value === null)))
    .map((v) => v.visual.id);
  expect(blank).toEqual([]);
}

describe("sampleAnchor", () => {
  it("is the first day of the current month", () => {
    expect(sampleAnchor(NOW)).toBe("DATE '2026-11-01'");
  });
});

describe("buildSamplePlan", () => {
  it("plans every table of the template with the same SQL each time", async () => {
    const template = await loadTemplate("vendas-executivo");
    const plan = buildSamplePlan(template, sampleAnchor(NOW));
    expect(plan.tables.map((t) => t.name).sort()).toEqual(template.tables.map((t) => t.name).sort());
    expect(plan.factRows).toBeGreaterThan(1000);
    expect(buildSamplePlan(template, sampleAnchor(NOW))).toEqual(plan);
  });
});

describe("literalDomains", () => {
  it("collects the literals a template compares a column with", async () => {
    const template = await loadTemplate("vendas-executivo");
    const withMeasure: Template = {
      ...template,
      measures: [...template.measures, { ...template.measures[0], id: "m_extra", sql: "SUM(CASE WHEN canal IN ('Loja', 'Online') THEN 1 END)" }],
    };
    const domains = literalDomains(withMeasure);
    expect([...domains.values()].some((values) => values.includes("Online"))).toBe(true);
  });
});

describe("ensureSampleFiles", () => {
  it("reuses the files already generated", async () => {
    const template = await loadTemplate("vendas-executivo");
    const root = await tempRoot();
    const first = await ensureSampleFiles(root, template, NOW);
    const second = await ensureSampleFiles(root, template, NOW);
    expect(second).toEqual(first);
  });

  it.each(BUILT_IN)("every visual of %s has data", async (id) => {
    await expectExplorable(await loadTemplate(id));
  });

  it.each(EXTRA)("every visual of %s has data", async (file) => {
    await expectExplorable(templateSchema.parse(JSON.parse(await readFile(file, "utf8"))));
  });
});
