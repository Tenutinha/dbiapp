/**
 * Converts an uploaded CSV/Parquet file into a contract-shaped, ZSTD-compressed Parquet file.
 * Runs inside the sandboxed DuckDB (reads/writes only under the storage root).
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows, quotePath, readParquet, withConnection } from "../duck/engine";
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
  /** Rows that came from each file, when the table is fed by several. */
  files?: { name: string; rowCount: number }[];
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
/** Only reads a file's columns (name + DuckDB type) — nothing is converted or written. */
export async function describeSource(storageRoot: string, sourcePath: string, format: SourceFormat): Promise<SourceColumn[]> {
  return withConnection(storageRoot, (conn) => describe(conn, reader(format, sourcePath)));
}

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
        `SELECT COUNT(*) AS n FROM ${readParquet(files[r.from.table])} f
         ANTI JOIN ${readParquet(files[r.to.table])} d ON f.${r.from.column} = d.${r.to.column}
         WHERE f.${r.from.column} IS NOT NULL`,
      );
      reports.push({ relationship: `${r.from.table}.${r.from.column} → ${r.to.table}`, orphans: Number(n) });
    }
    return reports;
  });
}

/** One source file already converted to the contract (by `ingestTable`), with the name the person knows it by. */
export interface TablePart {
  path: string;
  name: string;
}

export interface PartsReport {
  /** Rows of each part, in the order given. */
  files: { name: string; rowCount: number }[];
  rowCount: number;
  errors: string[];
}

const MAX_REPEATED_SHOWN = 3;

/** `"A1" em a.csv e b.csv; …`: the first keys that are in more than one part, and the files of each. */
async function repeatedKeys(conn: DuckDBConnection, parts: readonly TablePart[], key: string): Promise<string | null> {
  const each = parts.map((p, i) => `SELECT CAST(${key} AS VARCHAR) AS k, ${i} AS i FROM read_parquet(${quotePath(p.path)})`);
  const [{ n }] = await queryRows(conn, `SELECT COUNT(*) - COUNT(DISTINCT k) AS n FROM (${each.join(" UNION ALL ")})`);
  if (Number(n) === 0) return null;
  const rows = await queryRows(
    conn,
    `SELECT k, string_agg(DISTINCT CAST(i AS VARCHAR), ',') AS files FROM (${each.join(" UNION ALL ")})
     GROUP BY k HAVING COUNT(*) > 1 ORDER BY k LIMIT ${MAX_REPEATED_SHOWN + 1}`,
  );
  const shown = rows.slice(0, MAX_REPEATED_SHOWN).map((r) => {
    const names = String(r.files).split(",").map(Number).sort((a, b) => a - b).map((i) => parts[i].name);
    return `"${String(r.k)}" em ${names.join(" e ")}`;
  });
  return (
    `Chave "${key}" repetida em ${Number(n).toLocaleString("pt-BR")} linhas entre os arquivos: ` +
    `${shown.join("; ")}${rows.length > MAX_REPEATED_SHOWN ? "; e outras" : ""}. Cada chave pode estar em um arquivo só.`
  );
}

/**
 * Checks the parts of one table as a whole, before they become the table: every part must be readable,
 * and a dimension key must not be in two files (each part alone was already validated when converted).
 * The parts are not rewritten — the table is read from all of them (see `readParquet`).
 */
export async function inspectParts(storageRoot: string, table: TemplateTable, parts: readonly TablePart[]): Promise<PartsReport> {
  return withConnection(storageRoot, async (conn) => {
    const files: PartsReport["files"] = [];
    try {
      for (const p of parts) {
        const [{ n }] = await queryRows(conn, `SELECT COUNT(*) AS n FROM read_parquet(${quotePath(p.path)})`);
        files.push({ name: p.name, rowCount: Number(n) });
      }
      const repeated = table.key ? await repeatedKeys(conn, parts, table.key) : null;
      return { files, rowCount: files.reduce((sum, f) => sum + f.rowCount, 0), errors: repeated ? [repeated] : [] };
    } catch (err) {
      console.error(`[ingest] ${table.name}: parts could not be read`, err);
      return { files, rowCount: 0, errors: ["Não foi possível ler os arquivos convertidos. Engate de novo."] };
    }
  });
}
