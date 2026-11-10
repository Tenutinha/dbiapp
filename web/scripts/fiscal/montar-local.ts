/**
 * Monta localmente as tabelas de um molde SPED a partir de arquivos .txt e roda cada visual do dashboard,
 * para conferir leitores e painéis com arquivos reais antes de carregar em produção.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/montar-local.ts <molde> <pasta de saída> <arquivo.txt> [...]
 * Com --so-consultas, reaproveita os Parquet já gerados na pasta de saída.
 */
import { once } from "node:events";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { queryRows, toDuckPath, withConnection } from "../../src/lib/duck/engine";
import { csvLine, toCsv } from "../../src/lib/fiscal/csv";
import { mergeByKey, SPED_DIMENSION_KEYS, type FiscalTables } from "../../src/lib/fiscal/importers";
import { factColumns, spedKindFor } from "../../src/lib/fiscal/sped-kinds";
import { appendSpedFile, writeChunk } from "../../src/lib/fiscal/sped-stream";
import { ingestTable } from "../../src/lib/ingest/ingest";
import { buildFilterOptionsQuery, buildVisualQuery, type QueryVisual } from "../../src/lib/query/build";
import { templateSchema } from "../../src/lib/templates/schema";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--so-consultas");
  const onlyQueries = process.argv.includes("--so-consultas");
  const [templateId, outDir, ...inputs] = args;
  const kind = spedKindFor(templateId ?? "");
  if (!kind || !outDir) throw new Error("uso: montar-local.ts <molde> <pasta de saída> <arquivo.txt> [...]");
  const t = templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", `${templateId}.json`), "utf8")));
  const root = toDuckPath(path.resolve(outDir));
  await mkdir(root, { recursive: true });
  const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `${root}/${tb.name}.parquet`]));

  if (!onlyQueries) {
    const fact = t.tables.find((tb) => tb.kind === "fact")!;
    const factCsv = `${root}/${fact.name}.csv`;
    const out = createWriteStream(factCsv, { encoding: "utf8" });
    await writeChunk(out, csvLine(factColumns(kind)));
    const parts: FiscalTables[] = [];
    let started = Date.now();
    for (const input of inputs) {
      const read = await appendSpedFile(kind, input, out);
      parts.push(read.dimensions);
      console.log(`lido ${path.basename(input).slice(0, 50)}: ${read.lines.toLocaleString("pt-BR")} linhas`);
    }
    out.end();
    await once(out, "close");
    console.log(`CSV da fato: ${(statSync(factCsv).size / 1024 ** 2).toFixed(0)} MB em ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const dims = mergeByKey(SPED_DIMENSION_KEYS, parts);
    for (const tb of t.tables) {
      const source = tb === fact ? factCsv : `${root}/${tb.name}.csv`;
      if (tb !== fact) await writeFile(source, toCsv(tb.columns.map((c) => c.name), dims[tb.name] ?? []), "utf8");
      started = Date.now();
      const report = await ingestTable({ storageRoot: root, table: tb, sourcePath: source, format: "csv", targetPath: files[tb.name] });
      console.log(`ingest ${tb.name}: ${report.ok ? `${report.rowCount.toLocaleString("pt-BR")} linhas, ${(report.sizeBytes / 1024 ** 2).toFixed(1)} MB` : `ERRO ${report.errors.join(" | ")}`} em ${((Date.now() - started) / 1000).toFixed(1)} s`);
      if (!report.ok) process.exit(1);
    }
  } else if (!existsSync(files[t.tables[0].name])) {
    throw new Error("não há Parquet na pasta de saída");
  }

  const failures: string[] = [];
  const timings: [string, number][] = [];
  let shown = 0;
  let empty = 0;
  const total = Date.now();
  await withConnection(root, async (conn) => {
    for (const fieldId of t.filters) {
      const q = buildFilterOptionsQuery(t, files, fieldId, {});
      const rows = await queryRows(conn, q.sql, q.params);
      console.log(`filtro ${fieldId}: ${rows.length} opções (${rows.slice(0, 4).map((r) => String(r.value).slice(0, 30)).join(" | ")})`);
    }
    // Same selection the page opens with: single-choice filters at their greatest value.
    const selection: Record<string, string[]> = {};
    for (const fieldId of Object.keys(t.filterDefaults)) {
      const q = buildFilterOptionsQuery(t, files, fieldId, {});
      const values = (await queryRows(conn, q.sql, q.params)).map((r) => String(r.value)).filter((v) => v !== "(sem cadastro)").sort();
      if (values.length) selection[fieldId] = [values[values.length - 1]];
    }
    console.log("seleção inicial:", JSON.stringify(selection));
    for (const v of t.visuals) {
      if (v.type === "text") continue;
      const started = Date.now();
      try {
        const q = buildVisualQuery(t, files, v as QueryVisual, selection);
        const rows = await queryRows(conn, q.sql, q.params);
        timings.push([v.id, Date.now() - started]);
        if (rows.length === 0 && v.hideEmpty) {
          empty += 1;
          continue;
        }
        shown += 1;
        if (v.type === "kpi") console.log(`  ${v.id}: ${JSON.stringify(rows[0])}`);
        else if (v.type !== "rows") console.log(`  ${v.id} (${v.type}): ${rows.length} linhas; ${JSON.stringify(rows[0] ?? null).slice(0, 220)}`);
        else console.log(`  ${v.id}: ${rows.length} linhas`);
      } catch (err) {
        failures.push(`${v.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }
  });
  timings.sort((a, b) => b[1] - a[1]);
  console.log(`\n${shown} visuais com dados, ${empty} escondidos (sem dados), ${failures.length} com erro; total ${((Date.now() - total) / 1000).toFixed(1)} s`);
  console.log("mais lentos:", timings.slice(0, 6).map(([id, ms]) => `${id} ${ms} ms`).join(", "));
  for (const f of failures) console.log(`ERRO ${f}`);
  if (failures.length) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
