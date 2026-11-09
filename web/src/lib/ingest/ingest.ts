/**
 * Converts an uploaded CSV/Parquet file into a contract-shaped, ZSTD-compressed Parquet file.
 * Runs inside the sandboxed DuckDB (reads/writes only under the storage root).
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows, quotePath, withConnection } from "../duck/engine";
import { sortColumns, type TemplateTable } from "../templates/schema";
import { castExpr, castSelect, matchColumns, quoteIdent, type ColumnMapping, type SourceColumn } from "./contract";

export type SourceFormat = "parquet" | "csv";

export interface TableReport {
  table: string;
  ok: boolean;
  rowCount: number;
  sizeBytes: number;
  errors: string[];
  warnings: string[];
}

export interface IngestInput {
  storageRoot: string;
  table: TemplateTable;
  sourcePath: string;
  format: SourceFormat;
  targetPath: string;
}

/**
 * CSV is read entirely as text: the contract decides the types (via TRY_CAST), so codes like
 * "00123" keep their leading zeros and a bad value on row 1M is reported, not thrown.
 */
function reader(format: SourceFormat, file: string): string {
  return format === "parquet"
    ? `read_parquet(${quotePath(file)})`
    : `read_csv(${quotePath(file)}, header = true, auto_detect = true, all_varchar = true)`;
}

async function describe(conn: DuckDBConnection, src: string): Promise<SourceColumn[]> {
  const rows = await queryRows(conn, `DESCRIBE SELECT * FROM ${src}`);
  return rows.map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
}

/** Values present in the source that could not be cast to the contract type. */
async function castFailures(conn: DuckDBConnection, src: string, mapping: readonly ColumnMapping[]): Promise<string[]> {
  const checks = mapping.filter((m) => m.source !== null && m.type !== "text");
  if (checks.length === 0) return [];
  const cols = checks.map(
    (m) => `COUNT(*) FILTER (WHERE ${quoteIdent(m.source as string)} IS NOT NULL AND ${castExpr(m)} IS NULL) AS ${m.target}`,
  );
  const [row] = await queryRows(conn, `SELECT ${cols.join(", ")} FROM ${src}`);
  return checks
    .filter((m) => Number(row[m.target]) > 0)
    .map((m) => `Coluna "${m.target}": ${Number(row[m.target]).toLocaleString("pt-BR")} valores não são do tipo ${m.type}.`);
}

/** Required columns must not be null; dimension keys must be unique. */
async function integrity(conn: DuckDBConnection, file: string, table: TemplateTable): Promise<string[]> {
  const src = `read_parquet(${quotePath(file)})`;
  const required = table.columns.filter((c) => c.required);
  const cols = [
    "COUNT(*) AS __rows",
    ...required.map((c) => `COUNT(*) FILTER (WHERE ${c.name} IS NULL) AS ${c.name}`),
    ...(table.key ? [`COUNT(*) - COUNT(DISTINCT ${table.key}) AS __dup_keys`] : []),
  ];
  const [row] = await queryRows(conn, `SELECT ${cols.join(", ")} FROM ${src}`);

  const errors = required
    .filter((c) => Number(row[c.name]) > 0)
    .map((c) => `Coluna obrigatória "${c.name}" tem ${Number(row[c.name]).toLocaleString("pt-BR")} valores vazios.`);
  if (table.key && Number(row.__dup_keys) > 0) {
    errors.push(`Chave "${table.key}" repetida em ${Number(row.__dup_keys).toLocaleString("pt-BR")} linhas.`);
  }
  if (Number(row.__rows) === 0) errors.push("O arquivo não tem linhas.");
  return errors;
}

/**
 * `targetPath` must be unique per upload (the caller adds a random suffix), so concurrent
 * uploads never write the same file and a published version's file is never overwritten.
 */
export async function ingestTable(input: IngestInput): Promise<TableReport> {
  const { table, targetPath } = input;
  const fail = (errors: string[], warnings: string[] = []): TableReport => ({
    table: table.name, ok: false, rowCount: 0, sizeBytes: 0, errors, warnings,
  });
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;

  return withConnection(input.storageRoot, async (conn) => {
    const src = reader(input.format, input.sourcePath);
    let columns: SourceColumn[];
    try {
      columns = await describe(conn, src);
    } catch {
      return fail([`Não foi possível ler o arquivo como ${input.format.toUpperCase()}.`]);
    }

    const match = matchColumns(table, columns);
    if (match.errors.length > 0) return fail(match.errors, match.warnings);

    try {
      const castErrors = await castFailures(conn, src, match.mapping);
      if (castErrors.length > 0) return fail(castErrors, match.warnings);

      await mkdir(path.dirname(targetPath), { recursive: true });
      const sortBy = sortColumns(table);
      const order = sortBy.length > 0 ? ` ORDER BY ${sortBy.join(", ")}` : "";
      await conn.run(
        `COPY (SELECT ${castSelect(match.mapping)} FROM ${src}${order}) TO ${quotePath(tmpPath)} ` +
          `(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880)`,
      );

      const integrityErrors = await integrity(conn, tmpPath, table);
      if (integrityErrors.length > 0) return fail(integrityErrors, match.warnings);

      await rename(tmpPath, targetPath);
      const [{ n }] = await queryRows(conn, `SELECT COUNT(*) AS n FROM read_parquet(${quotePath(targetPath)})`);
      return {
        table: table.name,
        ok: true,
        rowCount: Number(n),
        sizeBytes: (await stat(targetPath)).size,
        errors: [],
        warnings: match.warnings,
      };
    } catch (err) {
      console.error(`[ingest] ${table.name} failed`, err);
      return fail(["Não foi possível processar o arquivo. Verifique se o conteúdo está íntegro."], match.warnings);
    } finally {
      await rm(tmpPath, { force: true });
    }
  });
}

export interface OrphanReport {
  relationship: string;
  orphans: number;
}

/**
 * Fact rows whose foreign key has no match in the dimension (shown as "(sem cadastro)").
 * Empty keys are not orphans: an optional key column means "not related" (e.g. blank votes).
 */
export async function checkRelationships(
  storageRoot: string,
  relationships: readonly { from: { table: string; column: string }; to: { table: string; column: string } }[],
  files: Readonly<Record<string, string>>,
): Promise<OrphanReport[]> {
  return withConnection(storageRoot, async (conn) => {
    const reports: OrphanReport[] = [];
    for (const r of relationships) {
      const [{ n }] = await queryRows(
        conn,
        `SELECT COUNT(*) AS n FROM read_parquet(${quotePath(files[r.from.table])}) f
         ANTI JOIN read_parquet(${quotePath(files[r.to.table])}) d ON f.${r.from.column} = d.${r.to.column}
         WHERE f.${r.from.column} IS NOT NULL`,
      );
      reports.push({ relationship: `${r.from.table}.${r.from.column} → ${r.to.table}`, orphans: Number(n) });
    }
    return reports;
  });
}
