/**
 * End-to-end check of each fiscal template: sample file → importer → CSV → ingest against the real
 * contract (web/fiscal-templates) → every visual and filter of the dashboard runs in DuckDB.
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDuckPath } from "../duck/engine";
import { ingestTable } from "../ingest/ingest";
import { runDashboard } from "../query/run";
import { templateSchema, type Template } from "../templates/schema";
import { toCsv } from "./csv";
import { FISCAL_IMPORTERS, mergeTables } from "./importers";
import { SAMPLE_FILES } from "./test-fixtures";

const loadFiscalTemplate = (id: string): Template =>
  templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", `${id}.json`), "utf8")));

let root = "";
beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-fiscal-")));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe.each(FISCAL_IMPORTERS.map((i) => [i.templateId, i] as const))("template %s", (templateId, importer) => {
  it("has a contract and an importer that agree on tables and columns", () => {
    const t = loadFiscalTemplate(templateId);
    const tables = importer.parse(SAMPLE_FILES[templateId]);
    expect(Object.keys(tables).sort()).toEqual(t.tables.map((tb) => tb.name).sort());
    for (const tb of t.tables) {
      for (const row of tables[tb.name]) {
        expect(Object.keys(row).sort()).toEqual(tb.columns.map((c) => c.name).sort());
      }
    }
  });

  it("ingests every table and runs every visual and filter", async () => {
    const t = loadFiscalTemplate(templateId);
    const merged = mergeTables(importer, [importer.parse(SAMPLE_FILES[templateId])]);
    const dir = path.join(root, templateId);
    await mkdir(path.join(dir, "in"), { recursive: true });
    const files: Record<string, string> = {};
    for (const tb of t.tables) {
      const source = path.join(dir, "in", `${tb.name}.csv`);
      await writeFile(source, toCsv(tb.columns.map((c) => c.name), merged[tb.name]));
      const target = toDuckPath(path.join(dir, `${tb.name}.parquet`));
      const report = await ingestTable({ storageRoot: root, table: tb, sourcePath: toDuckPath(source), format: "csv", targetPath: target });
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
      files[tb.name] = target;
    }
    const data = await runDashboard(root, t, files, {});
    expect(data.visuals.filter((v) => v.error).map((v) => v.visual.id)).toEqual([]);
    expect(data.filters.every((f) => f.values.length > 0 || f.fieldId === "centro_custo")).toBe(true);
  });
});
