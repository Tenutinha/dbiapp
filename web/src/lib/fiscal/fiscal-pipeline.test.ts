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
import { buildVisualQuery, MissingFactError, type QueryVisual } from "../query/build";
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
    const absent = new Set<string>();
    if (importer.mode === "sped") {
      // Same path as the service: the raw file is streamed from disk into the fact CSV.
      const raw = path.join(dir, "in", "arquivo.txt");
      await writeFile(raw, SAMPLE_FILES[templateId]);
      const fact = t.tables.find((tb) => tb.kind === "fact")!;
      // The block facts of the kind (e.g. bloco_a_servicos) are written in the same pass.
      const blockTables = Object.keys(importer.kind.blockFacts);
      const outs = Object.fromEntries([fact.name, ...blockTables].map((name) => [name, createWriteStream(csv(name), { encoding: "utf8" })]));
      for (const out of Object.values(outs)) await writeChunk(out, csvLine(factColumns(importer.kind)));
      const read = await appendSpedFile(importer.kind, raw, {
        fact: outs[fact.name], blocks: Object.fromEntries(blockTables.map((name) => [name, outs[name]])),
      });
      for (const out of Object.values(outs)) out.end();
      await Promise.all(Object.values(outs).map((out) => once(out, "close")));
      expect(read.lines).toBeGreaterThan(5);
      expect(factColumns(importer.kind)).toEqual(fact.columns.map((c) => c.name));
      tables = read.dimensions;
      streamed.add(fact.name);
      // Like the service: a block the file does not bring leaves its fact out (the ingest refuses empty tables).
      for (const name of blockTables) (read.blockLines[name] > 0 ? streamed : absent).add(name);
      if (templateId === "efd-contribuicoes") {
        expect(read.blockLines).toMatchObject({
          bloco_a_servicos: 6, bloco_f_demais_operacoes: 2, bloco_m_apuracao_pis_cofins: 4, bloco_d_transporte_comunicacao: 0,
          // C010 and C170 (the note, C100, is left out); and the item alone.
          bloco_c_resumo: 2, bloco_c_resumo_itens: 1,
        });
      }
    } else {
      tables = mergeTables(importer, [importer.parse(SAMPLE_FILES[templateId])]);
    }

    const files: Record<string, string> = {};
    for (const tb of t.tables) {
      if (absent.has(tb.name)) continue;
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
          if (err instanceof MissingFactError && absent.has(v.fact ?? "")) continue;
          failures.push(`${v.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        }
      }
    });
    expect(failures).toEqual([]);

    const data = await runDashboard(root, t, files, {});
    expect(data.visuals.filter((v) => v.error).map((v) => v.visual.id)).toEqual([]);
    expect(data.visuals.some((v) => v.visual.type === "kpi" && v.rows[0] && Object.values(v.rows[0])[0] !== null)).toBe(true);
    if (templateId === "efd-contribuicoes") {
      // The sections of the blocks read their own facts; the original data of a block too.
      const first = (id: string): unknown => Object.values(data.visuals.find((v) => v.visual.id === id)?.rows[0] ?? {})[0];
      expect([first("k_m_pis_recolher"), first("k_m_cofins_recolher"), first("k_f_aquisicoes")]).toEqual([23.1, 106.4, 200]);
      expect(t.visuals.find((v) => v.id === "r_m200")?.fact).toBe("bloco_m_apuracao_pis_cofins");
      // Bloco A opens with its totals by competência: the item and the valid note of the sample, the cancelled one left out.
      expect(t.analyses.find((a) => a.id === "bloco_a")?.visuals[0]).toBe("t_a_competencia");
      expect(data.visuals.find((v) => v.visual.id === "t_a_competencia")?.rows).toEqual([{
        competencia: "2025-01", a_notas: 1, a_itens: 1, a_vl_doc: 600, a_vl_item: 600, a_vl_desc: 0, a_vl_bc_pis: 600, a_vl_pis: 9.9,
        a_vl_bc_cofins: 600, a_vl_cofins: 45.6, a_vl_pis_ret: 0, a_vl_cofins_ret: 0, a_vl_iss: 24,
      }]);
      // The original lines of bloco C stay with the main fact: its extra facts are summaries.
      expect(t.visuals.find((v) => v.id === "r_c100")?.fact).toBeUndefined();
      // The summaries hold the item of the sample (C170) with its values, without the note it came from.
      expect([first("k_c_receita"), first("k_c_pis_debito"), first("k_c_cofins_debito")]).toEqual([1000, 16.5, 76]);
      const item = data.visuals.find((v) => v.visual.id === "t_c_itens")?.rows[0];
      expect(item).toMatchObject({ item: "AMORTECEDOR", ncm: "87088000", receita: 1000 });
    }
  }, 120_000);
});

describe("EFD Contribuições: bloco A as a fact of its own", () => {
  const t = loadFiscalTemplate("efd-contribuicoes");
  const kind = FISCAL_IMPORTERS.find((i) => i.templateId === "efd-contribuicoes")!;
  const value = (data: Awaited<ReturnType<typeof runDashboard>>, id: string): unknown =>
    Object.values(data.visuals.find((v) => v.visual.id === id)?.rows[0] ?? {})[0];

  it("reads only the block facts, stopping when the block is over, and answers the section from them", async () => {
    if (kind.mode !== "sped") throw new Error("expected a SPED importer");
    const dir = path.join(root, "bloco-a");
    await mkdir(dir, { recursive: true });
    const raw = path.join(dir, "arquivo.txt");
    await writeFile(raw, SAMPLE_FILES["efd-contribuicoes"]);
    const csv = path.join(dir, "bloco_a_servicos.csv");
    const out = createWriteStream(csv, { encoding: "utf8" });
    await writeChunk(out, csvLine(factColumns(kind.kind)));
    const read = await appendSpedFile(kind.kind, raw, { fact: null, blocks: { bloco_a_servicos: out } });
    out.end();
    await once(out, "close");
    // 0000, 0140, 0150, 0200 and the six records of bloco A: the blocks after it are not read.
    expect(read).toMatchObject({ lines: 10, blockLines: { bloco_a_servicos: 6 } });
    expect(read.dimensions.participantes).toHaveLength(1);

    const files: Record<string, string> = {};
    for (const tb of t.tables.filter((x) => x.kind === "dimension" || x.name === "bloco_a_servicos")) {
      const source = tb.name === "bloco_a_servicos" ? csv : path.join(dir, `${tb.name}.csv`);
      if (tb.name !== "bloco_a_servicos") await writeFile(source, toCsv(tb.columns.map((c) => c.name), read.dimensions[tb.name]));
      const target = toDuckPath(path.join(dir, `${tb.name}.parquet`));
      const report = await ingestTable({ storageRoot: root, table: tb, sourcePath: toDuckPath(source), format: "csv", targetPath: target });
      expect(report.errors, tb.name).toEqual([]);
      files[tb.name] = target;
    }
    const section = t.analyses.find((a) => a.id === "servicos_bloco_a")!;
    expect(section.visuals.length).toBeGreaterThan(5);
    const rows: Record<string, number> = {};
    await withConnection(root, async (conn) => {
      for (const id of ["k_serv_valor", "k_serv_notas", "k_serv_canceladas", "k_serv_pis", "k_serv_iss"]) {
        const q = buildVisualQuery(t, files, t.visuals.find((v) => v.id === id) as QueryVisual, {});
        expect(q.sql).toContain("bloco_a_servicos.parquet') AS registros");
        rows[id] = Number(Object.values((await queryRows(conn, q.sql, q.params))[0])[0]);
      }
    });
    // The cancelled note (502) counts as cancelled and stays out of the values.
    expect(rows).toEqual({ k_serv_valor: 600, k_serv_notas: 1, k_serv_canceladas: 1, k_serv_pis: 9.9, k_serv_iss: 24 });
  }, 120_000);

  it("shows the section empty, not broken, while the block fact has no file", async () => {
    const dir = path.join(root, "efd-contribuicoes");
    const files = Object.fromEntries(
      t.tables.filter((tb) => tb.kind === "dimension" || tb.name === "registros").map((tb) => [tb.name, toDuckPath(path.join(dir, `${tb.name}.parquet`))]),
    );
    const data = await runDashboard(root, t, files, {});
    expect(data.visuals.filter((v) => v.error).map((v) => v.visual.id)).toEqual([]);
    expect(data.visuals.find((v) => v.visual.id === "k_serv_valor")?.rows).toEqual([]);
    expect(value(data, "k_receita")).not.toBeNull();
  }, 120_000);
});
