/**
 * Confere as tabelas que as receitas montaram com as publicadas (ou outra referência): mesmas linhas, nas
 * colunas que a receita entrega. Decimais comparados com 6 casas.
 *
 * Uso (em web/):
 *   node --import tsx scripts/feeds/conferir.ts --montado <pasta do molde> --referencia <pasta> [--colunas <template.json>]
 *
 * Com --colunas, só as colunas do contrato do template contam (a referência pode ter colunas a mais).
 * Sai com código 1 se alguma tabela diferir.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { quotePath, toDuckPath } from "../../src/lib/duck/engine";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function rows(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[];
}

async function tipos(conn: DuckDBConnection, arquivo: string): Promise<Map<string, string>> {
  const r = await rows(conn, `DESCRIBE SELECT * FROM read_parquet(${quotePath(arquivo)})`);
  return new Map(r.map((x) => [String(x.column_name), String(x.column_type)]));
}

/** Expressão comparável: decimais arredondados, datas e horas como data/hora, o resto como texto. */
function comparavel(col: string, tipo: string): string {
  if (/DOUBLE|FLOAT|DECIMAL|REAL/.test(tipo)) return `ROUND(CAST("${col}" AS DOUBLE), 6) AS "${col}"`;
  if (/INT/.test(tipo)) return `CAST("${col}" AS BIGINT) AS "${col}"`;
  // DATE do contrato contra TIMESTAMP da extração: os dois como data/hora.
  if (/^(DATE|TIMESTAMP)/.test(tipo)) return `CAST(CAST("${col}" AS TIMESTAMP) AS VARCHAR) AS "${col}"`;
  return `CAST("${col}" AS VARCHAR) AS "${col}"`;
}

async function conferirTabela(conn: DuckDBConnection, montado: string, referencia: string, contrato: string[] | null): Promise<boolean> {
  const tm = await tipos(conn, montado);
  const tr = await tipos(conn, referencia);
  const cols = [...tm.keys()].filter((c) => !contrato || contrato.includes(c));
  const semRef = cols.filter((c) => !tr.has(c));
  const faltam = (contrato ?? []).filter((c) => !tm.has(c));
  if (faltam.length > 0) console.log(`      a receita não entrega: ${faltam.join(", ")}`);
  if (semRef.length > 0) console.log(`      sem par na referência: ${semRef.join(", ")}`);
  const comuns = cols.filter((c) => tr.has(c));
  const sel = (arquivo: string, t: Map<string, string>): string =>
    `SELECT ${comuns.map((c) => comparavel(c, t.get(c) as string)).join(", ")} FROM read_parquet(${quotePath(arquivo)})`;
  const [n] = await rows(conn, `SELECT
    (SELECT COUNT(*) FROM read_parquet(${quotePath(montado)})) AS montado,
    (SELECT COUNT(*) FROM read_parquet(${quotePath(referencia)})) AS referencia,
    (SELECT COUNT(*) FROM (${sel(montado, tm)} EXCEPT ALL ${sel(referencia, tr)})) AS so_montado,
    (SELECT COUNT(*) FROM (${sel(referencia, tr)} EXCEPT ALL ${sel(montado, tm)})) AS so_referencia`);
  const ok = Number(n.so_montado) === 0 && Number(n.so_referencia) === 0 && faltam.length === 0 && semRef.length === 0;
  console.log(`      linhas ${n.montado} × ${n.referencia}; só na montada ${n.so_montado}; só na referência ${n.so_referencia} (${comuns.length} colunas)`);
  if (!ok && Number(n.so_montado) > 0) {
    const ex = await rows(conn, `(${sel(montado, tm)} EXCEPT ALL ${sel(referencia, tr)}) LIMIT 2`);
    for (const e of ex) console.log(`      montada:    ${JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? Number(v) : v))}`);
    const er = await rows(conn, `(${sel(referencia, tr)} EXCEPT ALL ${sel(montado, tm)}) LIMIT 2`);
    for (const e of er) console.log(`      referência: ${JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? Number(v) : v))}`);
  }
  return ok;
}

async function main(): Promise<void> {
  const montado = arg("--montado");
  const referencia = arg("--referencia");
  if (!montado || !referencia) throw new Error("uso: conferir.ts --montado <pasta> --referencia <pasta> [--colunas <template.json>]");
  const template = arg("--colunas");
  const contratos = new Map<string, string[]>();
  if (template) {
    const t = JSON.parse(readFileSync(template, "utf8")) as { tables: { name: string; columns: { name: string }[] }[] };
    for (const tb of t.tables) contratos.set(tb.name, tb.columns.map((c) => c.name));
  }
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  let tudoOk = true;
  for (const f of readdirSync(montado).filter((x) => x.endsWith(".parquet")).sort()) {
    const tabela = f.replace(/\.parquet$/, "");
    console.log(`${tabela}`);
    const ok = await conferirTabela(conn, toDuckPath(path.resolve(montado, f)), toDuckPath(path.resolve(referencia, f)), contratos.get(tabela) ?? null);
    console.log(ok ? "  ok" : "  DIFERE");
    tudoOk &&= ok;
  }
  conn.closeSync();
  console.log(tudoOk ? "\nTudo igual." : "\nHá diferenças.");
  if (!tudoOk) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
