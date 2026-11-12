/**
 * Valida um template gerado a partir de um .pbix (skill pbix-importar).
 *
 * 1. Schema: templateSchema (o mesmo do cadastro).
 * 2. Com --dados: roda no motor real (DuckDB sandboxed) cada tabela, campo, medida, visual e filtro
 *    sobre os Parquet extraídos, e mostra amostras dos resultados para conferir com o Power BI.
 *
 * Uso (em web/):
 *   node --import tsx scripts/pbix/validar-template.ts <template.json> [--dados <pasta com <tabela>.parquet>]
 * Sai com código 1 se algo falhar.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { queryRows, toDuckPath, withConnection, type Row } from "../../src/lib/duck/engine";
import { buildFilterOptionsQuery, buildVisualQuery, type QueryVisual, type TableFiles } from "../../src/lib/query/build";
import { templateSchema, type Template } from "../../src/lib/templates/schema";

type Conn = Parameters<typeof queryRows>[0];

interface Args {
  templatePath: string;
  dataDir?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const [templatePath, ...rest] = argv;
  if (!templatePath) throw new Error("uso: validar-template.ts <template.json> [--dados <pasta>]");
  const i = rest.indexOf("--dados");
  return { templatePath, dataDir: i >= 0 ? rest[i + 1] : undefined };
}

function fmt(rows: readonly Row[], max = 3): string {
  return rows.slice(0, max).map((r) => JSON.stringify(r)).join(" | ") || "(sem linhas)";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

async function check(label: string, failures: string[], fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ok    ${label}: ${await fn()}`);
  } catch (err) {
    failures.push(label);
    console.log(`  ERRO  ${label}: ${errorText(err)}`);
  }
}

async function checkTables(conn: Conn, t: Template, files: TableFiles, failures: string[]): Promise<void> {
  console.log("\nTabelas (colunas do contrato x Parquet):");
  for (const table of t.tables) {
    await check(table.name, failures, async () => {
      const described = await queryRows(conn, `DESCRIBE SELECT * FROM read_parquet('${toDuckPath(files[table.name])}')`);
      const present = new Set(described.map((r) => String(r.column_name)));
      const missing = table.columns.filter((c) => !present.has(c.name)).map((c) => c.name);
      if (missing.length) throw new Error(`colunas ausentes no Parquet: ${missing.join(", ")}`);
      // O ingest recusa vazios em colunas obrigatórias: conferir aqui evita descobrir só na carga.
      const required = table.columns.filter((c) => c.required).map((c) => c.name);
      const counts = required.map((c) => `COUNT(*) FILTER (WHERE "${c}" IS NULL OR CAST("${c}" AS VARCHAR) = '')::BIGINT AS "${c}"`);
      const [row] = await queryRows(conn, `SELECT COUNT(*)::BIGINT AS _linhas${counts.length ? `, ${counts.join(", ")}` : ""}
        FROM read_parquet('${toDuckPath(files[table.name])}')`);
      const empty = required.filter((c) => Number(row[c]) > 0).map((c) => `${c} (${row[c]})`);
      if (empty.length) throw new Error(`colunas obrigatórias com vazios: ${empty.join(", ")} — marque "required": false ou trate os dados`);
      return `${row._linhas} linhas`;
    });
  }
}

async function runVisual(conn: Conn, t: Template, files: TableFiles, visual: QueryVisual): Promise<Row[]> {
  const q = buildVisualQuery(t, files, visual, {});
  return queryRows(conn, q.sql, q.params);
}

/**
 * The fact an expression is read from: the main one when it reaches every table the expression mentions,
 * otherwise the first extra fact that does (e.g. a field of the targets, or of the bills to pay).
 * Undefined means the main fact.
 */
function factFor(t: Template, sql: string): string | undefined {
  const facts = t.tables.filter((tb) => tb.kind === "fact");
  const mentioned = t.tables.filter((tb) => new RegExp(`\\b${tb.name}\\.`).test(sql)).map((tb) => tb.name);
  for (const [i, fact] of facts.entries()) {
    // One pass, like the engine (reachOf): the schema requires each relationship to start at a table already joined.
    const reached = new Set([fact.sameAs ?? fact.name]);
    for (const r of t.relationships) if (reached.has(r.from.table)) reached.add(r.to.table);
    if (mentioned.every((name) => reached.has(name) || name === fact.name)) return i === 0 ? undefined : fact.name;
  }
  return undefined;
}

async function checkModel(conn: Conn, t: Template, files: TableFiles, failures: string[]): Promise<void> {
  console.log("\nMedidas (total geral, sem filtros):");
  for (const m of t.measures) {
    // A measure of an extra fact (e.g. the targets) is read from that fact.
    const fact = factFor(t, m.sql);
    await check(m.id, failures, async () => {
      const rows = await runVisual(conn, t, files, { id: "v", type: "kpi", title: m.label, span: 12, measure: m.id, fact });
      return fmt(rows, 1);
    });
  }
  const firstMeasure = t.measures[0].id;
  console.log(`\nCampos (top 3 pela 1ª medida da fato que o campo alcança):`);
  for (const f of t.fields) {
    const fact = factFor(t, f.sql);
    const measure = t.measures.find((m) => factFor(t, m.sql) === fact)?.id ?? firstMeasure;
    await check(f.id, failures, async () => {
      const visual: QueryVisual = {
        id: "v", type: "bar", title: f.label, span: 12, field: f.id, measures: [measure],
        sort: "measure_desc", limit: 3, horizontal: false, fact,
      };
      return fmt(await runVisual(conn, t, files, visual));
    });
  }
}

async function checkVisuals(conn: Conn, t: Template, files: TableFiles, failures: string[]): Promise<void> {
  console.log("\nVisuais:");
  for (const v of t.visuals) {
    if (v.type === "text") continue;
    await check(`${v.id} (${v.type})`, failures, async () => {
      const rows = await runVisual(conn, t, files, v);
      return `${rows.length} linhas; ${fmt(rows, 2)}`;
    });
  }
  console.log("\nFiltros:");
  for (const fieldId of t.filters) {
    await check(fieldId, failures, async () => {
      const q = buildFilterOptionsQuery(t, files, fieldId, {});
      const rows = await queryRows(conn, q.sql, q.params);
      return `${rows.length} opções; ${rows.slice(0, 5).map((r) => r.value).join(", ")}`;
    });
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const parsed = templateSchema.safeParse(JSON.parse(readFileSync(args.templatePath, "utf8")));
  if (!parsed.success) {
    console.log("Schema: INVÁLIDO");
    for (const issue of parsed.error.issues) console.log(`  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`);
    return 1;
  }
  const t = parsed.data;
  console.log(`Schema: ok — ${t.tables.length} tabelas, ${t.measures.length} medidas, ${t.visuals.length} visuais`);
  if (!args.dataDir) return 0;

  const root = toDuckPath(path.resolve(args.dataDir));
  const files: Record<string, string> = {};
  for (const table of t.tables) {
    const file = `${root}/${table.name}.parquet`;
    if (!existsSync(file)) {
      console.log(`Dados: falta ${file}`);
      return 1;
    }
    files[table.name] = file;
  }

  const failures: string[] = [];
  await withConnection(root, async (conn) => {
    await checkTables(conn, t, files, failures);
    await checkModel(conn, t, files, failures);
    await checkVisuals(conn, t, files, failures);
  });
  console.log(failures.length ? `\n${failures.length} falha(s): ${failures.join(", ")}` : "\nTudo ok.");
  return failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(errorText(err));
    process.exit(1);
  },
);
