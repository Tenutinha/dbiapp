/**
 * End-to-end engine test: generate files → ingest against the contract → run the dashboard.
 * Uses a temporary storage root and the real sandboxed DuckDB.
 */
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryRows, toDuckPath, withConnection } from "../duck/engine";
import { checkRelationships, ingestTable } from "../ingest/ingest";
import { loadTemplate } from "../test-helpers";
import { runDashboard } from "./run";

const t = loadTemplate("vendas-executivo");
let root = "";
const incoming = (f: string): string => path.join(root, "_incoming", f);
const target = (table: string): string => path.join(root, "ws", "inst", "v1", `${table}.parquet`);

beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-test-")));
  await mkdir(path.join(root, "_incoming"), { recursive: true });
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const q = (f: string): string => `'${toDuckPath(incoming(f))}'`;
  await c.run(`COPY (SELECT i AS id_loja, 'Loja ' || i AS loja, CASE WHEN i <= 2 THEN 'Sul' ELSE 'Norte' END AS regiao,
                 'Própria' AS canal FROM range(1, 5) t(i)) TO ${q("dim_loja.parquet")} (FORMAT parquet)`);
  await c.run(`COPY (SELECT i AS "ID Produto", 'P' || i AS Produto, 'Cat ' || (i % 2) AS Categoria FROM range(1, 11) t(i))
               TO ${q("dim_produto.csv")} (HEADER)`);
  await c.run(`COPY (SELECT i AS id_cliente, 'C' || i AS nome, 'Varejo' AS segmento, 'SP' AS uf FROM range(1, 6) t(i))
               TO ${q("dim_cliente.parquet")} (FORMAT parquet)`);
  await c.run(`COPY (SELECT i AS id_venda, DATE '2025-01-01' + (i % 60)::INTEGER AS data, 1 + i % 5 AS id_cliente,
                 1 + i % 10 AS id_produto, 1 + i % 5 AS id_loja, 1 AS quantidade, 100.0 AS valor_bruto,
                 0.0 AS desconto, 100.0 AS valor_liquido, 60.0 AS custo FROM range(0, 1000) t(i))
               TO ${q("fato_vendas.parquet")} (FORMAT parquet)`);
  // a broken dimension: duplicated key + non-numeric id
  await c.run(`COPY (SELECT * FROM (VALUES ('1','a','b','c'), ('1','a','b','c'), ('x','a','b','c'))
                 t(id_loja, loja, regiao, canal)) TO ${q("dim_loja_bad.csv")} (HEADER)`);
  // text codes with leading zeros + a non-numeric id far beyond any type-sniffing sample
  await c.run(`COPY (SELECT CASE WHEN i = 45000 THEN 'abc' ELSE i::VARCHAR END AS id_produto,
                 lpad(i::VARCHAR, 6, '0') AS produto, 'Cat' AS categoria FROM range(1, 50001) t(i))
               TO ${q("dim_produto_late_bad.csv")} (HEADER)`);
  await c.run(`COPY (SELECT i AS id_produto, lpad(i::VARCHAR, 6, '0') AS produto, 'Cat' AS categoria
                 FROM range(1, 11) t(i)) TO ${q("dim_produto_codes.csv")} (HEADER)`);
  await c.run(`COPY (SELECT 1 AS id_loja, 'a' AS loja, 'b' AS regiao, 'c' AS canal WHERE false)
               TO ${q("dim_loja_empty.csv")} (HEADER)`);
  c.closeSync();
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const table = (name: string) => t.tables.find((tb) => tb.name === name)!;

describe("ingest + dashboard pipeline", () => {
  it("rejects values that do not match the contract type", async () => {
    const report = await ingestTable({
      storageRoot: root, table: table("dim_loja"), sourcePath: incoming("dim_loja_bad.csv"),
      format: "csv", targetPath: target("dim_loja_bad"),
    });
    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("id_loja");
  });

  it("reports a bad value deep in a CSV instead of crashing", async () => {
    const report = await ingestTable({
      storageRoot: root, table: table("dim_produto"), sourcePath: incoming("dim_produto_late_bad.csv"),
      format: "csv", targetPath: target("late_bad"),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(['Coluna "id_produto": 1 valores não são do tipo integer.']);
  });

  it("keeps leading zeros in text columns from CSV", async () => {
    const out = target("codes");
    const report = await ingestTable({
      storageRoot: root, table: table("dim_produto"), sourcePath: incoming("dim_produto_codes.csv"),
      format: "csv", targetPath: out,
    });
    expect(report.ok).toBe(true);
    const rows = await withConnection(root, (conn) =>
      queryRows(conn, `SELECT produto FROM read_parquet('${toDuckPath(out)}') ORDER BY id_produto LIMIT 1`));
    expect(rows[0].produto).toBe("000001");
  });

  it("rejects an empty file and leaves no temp files behind", async () => {
    const report = await ingestTable({
      storageRoot: root, table: table("dim_loja"), sourcePath: incoming("dim_loja_empty.csv"),
      format: "csv", targetPath: target("empty"),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain("O arquivo não tem linhas.");
    const leftovers = (await readdir(path.dirname(target("x")))).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("ingests all tables (CSV headers are normalised, optional columns filled)", async () => {
    const sources: Record<string, [string, "csv" | "parquet"]> = {
      fato_vendas: ["fato_vendas.parquet", "parquet"],
      dim_loja: ["dim_loja.parquet", "parquet"],
      dim_produto: ["dim_produto.csv", "csv"],
      dim_cliente: ["dim_cliente.parquet", "parquet"],
    };
    for (const [name, [file, format]] of Object.entries(sources)) {
      const report = await ingestTable({
        storageRoot: root, table: table(name), sourcePath: incoming(file), format, targetPath: target(name),
      });
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it("reports fact rows with no matching dimension", async () => {
    const files = Object.fromEntries(t.tables.map((tb) => [tb.name, target(tb.name)]));
    const orphans = await checkRelationships(root, t.relationships, files);
    expect(orphans.find((o) => o.relationship.includes("dim_loja"))?.orphans).toBe(200); // id_loja 5 not in dim
  });

  it("computes measures and honours filters", async () => {
    const files = Object.fromEntries(t.tables.map((tb) => [tb.name, target(tb.name)]));
    const all = await runDashboard(root, t, files, {});
    const kpi = (d: typeof all, id: string) => d.visuals.find((v) => v.visual.id === id)!.rows[0];
    expect(all.visuals.every((v) => !v.error)).toBe(true);
    expect(kpi(all, "k_receita").receita).toBe(100_000);
    expect(kpi(all, "k_margem").margem).toBeCloseTo(0.4);

    const sul = await runDashboard(root, t, files, { regiao: ["Sul"] });
    expect(kpi(sul, "k_receita").receita).toBe(40_000);
    expect(all.filters.find((f) => f.fieldId === "regiao")?.values).toEqual(["(sem cadastro)", "Norte", "Sul"]);

    // orphan facts (id_loja 5 has no dimension row) are listed and filterable
    const orphans = await runDashboard(root, t, files, { regiao: ["(sem cadastro)"] });
    expect(kpi(orphans, "k_receita").receita).toBe(20_000);
  });

  it("cannot read files outside the storage root", async () => {
    const files = Object.fromEntries(t.tables.map((tb) => [tb.name, target(tb.name)]));
    const outside = { ...files, fato_vendas: path.join(os.tmpdir(), "elsewhere.parquet") };
    const result = await runDashboard(root, t, outside, {}).catch((e: Error) => e);
    const failed = result instanceof Error || result.visuals.every((v) => v.error);
    expect(failed).toBe(true);
  });
});
