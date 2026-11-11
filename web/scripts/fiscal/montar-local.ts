/**
 * Monta localmente as tabelas de um molde SPED a partir de arquivos .txt e roda cada visual do dashboard,
 * para conferir leitores e painéis com arquivos reais antes de carregar em produção.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/montar-local.ts <molde> <pasta de saída> <arquivo.txt> [...]
 * Com --so-consultas, reaproveita os Parquet já gerados na pasta de saída.
 * Com --so-blocos, monta só as tabelas por bloco (ex.: bloco_a_servicos, o bloco A) e as dimensões, lendo cada
 * arquivo até o fim desses blocos.
 */
import { once } from "node:events";
import { createWriteStream, existsSync, readFileSync, statSync, type WriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { queryRows, toDuckPath, withConnection } from "../../src/lib/duck/engine";
import { csvLine, toCsv } from "../../src/lib/fiscal/csv";
import { KeyedTables, SPED_DIMENSION_KEYS } from "../../src/lib/fiscal/importers";
import { factColumns, spedKindFor } from "../../src/lib/fiscal/sped-kinds";
import { appendSpedFile, writeChunk } from "../../src/lib/fiscal/sped-stream";
import { ingestTable } from "../../src/lib/ingest/ingest";
import { buildFilterOptionsQuery, buildVisualQuery, type QueryVisual } from "../../src/lib/query/build";
import { extraFacts, mainFact, templateSchema } from "../../src/lib/templates/schema";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--so-"));
  const onlyQueries = process.argv.includes("--so-consultas");
  const onlyBlocks = process.argv.includes("--so-blocos");
  const [templateId, outDir, ...inputs] = args;
  const kind = spedKindFor(templateId ?? "");
  if (!kind || !outDir) throw new Error("uso: montar-local.ts <molde> <pasta de saída> <arquivo.txt> [...]");
  const t = templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", `${templateId}.json`), "utf8")));
  const root = toDuckPath(path.resolve(outDir));
  await mkdir(root, { recursive: true });
  const allFiles = Object.fromEntries(t.tables.map((tb) => [tb.name, `${root}/${tb.name}.parquet`]));

  const fact = mainFact(t);
  const blockTables = extraFacts(t).map((tb) => tb.name).filter((name) => name in kind.blockFacts);
  if (onlyBlocks && blockTables.length === 0) throw new Error(`o molde ${t.id} não tem tabelas por bloco`);
  if (!onlyQueries) {
    const csvOf = (table: string): string => `${root}/${table}.csv`;
    const open = (table: string): WriteStream => createWriteStream(csvOf(table), { encoding: "utf8" });
    const factOut = onlyBlocks ? null : open(fact.name);
    const blockOuts = Object.fromEntries(blockTables.map((table) => [table, open(table)]));
    const outs = [...(factOut ? [factOut] : []), ...Object.values(blockOuts)];
    for (const out of outs) await writeChunk(out, csvLine(factColumns(kind)));
    const dimensions = new KeyedTables(SPED_DIMENSION_KEYS);
    const blockLines: Record<string, number> = {};
    let started = Date.now();
    for (const input of inputs) {
      const read = await appendSpedFile(kind, input, { fact: factOut, blocks: blockOuts });
      dimensions.add(read.dimensions);
      for (const [table, n] of Object.entries(read.blockLines)) blockLines[table] = (blockLines[table] ?? 0) + n;
      const blocks = Object.entries(read.blockLines).map(([table, n]) => `, ${table} ${n.toLocaleString("pt-BR")}`).join("");
      console.log(`lido ${path.basename(input).slice(0, 50)}: ${read.lines.toLocaleString("pt-BR")} linhas${blocks}`);
    }
    for (const out of outs) out.end();
    await Promise.all(outs.map((out) => once(out, "close")));
    const written = [...(factOut ? [fact.name] : []), ...blockTables.filter((table) => (blockLines[table] ?? 0) > 0)];
    console.log(`CSV das fatos (${written.join(", ")}): ${(written.reduce((s, table) => s + statSync(csvOf(table)).size, 0) / 1024 ** 2).toFixed(1)} MB em ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const dims = dimensions.tables();
    for (const tb of t.tables) {
      // A fact that was not written (the main one with --so-blocos, a block the files do not bring) is left out.
      if (tb.kind === "fact" && !written.includes(tb.name)) continue;
      const source = csvOf(tb.name);
      if (tb.kind !== "fact") await writeFile(source, toCsv(tb.columns.map((c) => c.name), dims[tb.name] ?? []), "utf8");
      started = Date.now();
      const report = await ingestTable({ storageRoot: root, table: tb, sourcePath: source, format: "csv", targetPath: allFiles[tb.name] });
      console.log(`ingest ${tb.name}: ${report.ok ? `${report.rowCount.toLocaleString("pt-BR")} linhas, ${(report.sizeBytes / 1024 ** 2).toFixed(1)} MB` : `ERRO ${report.errors.join(" | ")}`} em ${((Date.now() - started) / 1000).toFixed(1)} s`);
      if (!report.ok) process.exit(1);
    }
  }
  // Only what is on disk: like a published version, an extra fact may be missing (and the main one with --so-blocos).
  const files = Object.fromEntries(Object.entries(allFiles).filter(([, file]) => existsSync(file)));
  if (Object.keys(files).length === 0) throw new Error("não há Parquet na pasta de saída");
  const hasMain = fact.name in files;

  const failures: string[] = [];
  const timings: [string, number][] = [];
  let shown = 0;
  let empty = 0;
  const total = Date.now();
  await withConnection(root, async (conn) => {
    for (const fieldId of hasMain ? t.filters : []) {
      const q = buildFilterOptionsQuery(t, files, fieldId, {});
      const rows = await queryRows(conn, q.sql, q.params);
      console.log(`filtro ${fieldId}: ${rows.length} opções (${rows.slice(0, 4).map((r) => String(r.value).slice(0, 30)).join(" | ")})`);
    }
    // Same selection the page opens with: single-choice filters at their greatest value.
    const selection: Record<string, string[]> = {};
    for (const fieldId of hasMain ? Object.keys(t.filterDefaults) : []) {
      const q = buildFilterOptionsQuery(t, files, fieldId, {});
      const values = (await queryRows(conn, q.sql, q.params)).map((r) => String(r.value)).filter((v) => v !== "(sem cadastro)").sort();
      if (values.length) selection[fieldId] = [values[values.length - 1]];
    }
    console.log("seleção inicial:", JSON.stringify(selection));
    for (const v of t.visuals) {
      if (v.type === "text") continue;
      // Without the main fact on disk, only the visuals of the facts that are there can run.
      if (!((v.fact ?? fact.name) in files)) continue;
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
