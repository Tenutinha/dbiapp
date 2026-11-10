/**
 * End-to-end check of each fiscal template: sample file → importer → CSV → ingest against the real
 * contract (web/fiscal-templates) → every visual and filter of the dashboard runs in DuckDB.
 */
import { once } from "node:events";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryRows, toDuckPath, withConnection } from "../duck/engine";
import { ingestTable } from "../ingest/ingest";
import { buildVisualQuery, type QueryVisual } from "../query/build";
import { runDashboard } from "../query/run";
import { templateSchema, type Template } from "../templates/schema";
import { csvLine, toCsv } from "./csv";
import { FISCAL_IMPORTERS, mergeTables, type FiscalTables } from "./importers";
import { factColumns } from "./sped-kinds";
import { appendSpedFile, writeChunk } from "./sped-stream";
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
  it("ingests every table and runs every visual and filter", async () => {
    const t = loadFiscalTemplate(templateId);
    const dir = path.join(root, templateId);
    await mkdir(path.join(dir, "in"), { recursive: true });
    const csv = (table: string): string => path.join(dir, "in", `${table}.csv`);

    let tables: FiscalTables;
    const streamed = new Set<string>();
    if (importer.mode === "sped") {
      // Same path as the service: the raw file is streamed from disk into the fact CSV.
      const raw = path.join(dir, "in", "arquivo.txt");
      await writeFile(raw, SAMPLE_FILES[templateId]);
      const fact = t.tables.find((tb) => tb.kind === "fact")!;
      const out = createWriteStream(csv(fact.name), { encoding: "utf8" });
      await writeChunk(out, csvLine(factColumns(importer.kind)));
      const read = await appendSpedFile(importer.kind, raw, out);
      out.end();
      await once(out, "close");
      expect(read.lines).toBeGreaterThan(5);
      expect(factColumns(importer.kind)).toEqual(fact.columns.map((c) => c.name));
      tables = read.dimensions;
      streamed.add(fact.name);
    } else {
      tables = mergeTables(importer, [importer.parse(SAMPLE_FILES[templateId])]);
    }

    const files: Record<string, string> = {};
    for (const tb of t.tables) {
      if (!streamed.has(tb.name)) {
        expect(tables[tb.name], tb.name).toBeDefined();
        await writeFile(csv(tb.name), toCsv(tb.columns.map((c) => c.name), tables[tb.name]));
      }
      const target = toDuckPath(path.join(dir, `${tb.name}.parquet`));
      const report = await ingestTable({ storageRoot: root, table: tb, sourcePath: toDuckPath(csv(tb.name)), format: "csv", targetPath: target });
      expect(report.errors, tb.name).toEqual([]);
      files[tb.name] = target;
    }

    // Each visual on its own, so a failure names the visual and shows DuckDB's message.
    const failures: string[] = [];
    await withConnection(root, async (conn) => {
      for (const v of t.visuals) {
        if (v.type === "text") continue;
        try {
          const q = buildVisualQuery(t, files, v as QueryVisual, {});
          await queryRows(conn, q.sql, q.params);
        } catch (err) {
          failures.push(`${v.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        }
      }
    });
    expect(failures).toEqual([]);

    const data = await runDashboard(root, t, files, {});
    expect(data.visuals.filter((v) => v.error).map((v) => v.visual.id)).toEqual([]);
    expect(data.visuals.some((v) => v.visual.type === "kpi" && v.rows[0] && Object.values(v.rows[0])[0] !== null)).toBe(true);
  }, 120_000);
});
