/**
 * Sandboxed DuckDB instance.
 *
 * Every connection can only read/write files under the storage root
 * (allowed_directories + enable_external_access=false), and configuration
 * is locked so no query can lift the sandbox.
 */
import { mkdir } from "node:fs/promises";
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";

export type Row = Record<string, string | number | boolean | null>;

interface EngineState {
  root: string;
  instance: Promise<DuckDBInstance>;
}
const globalForDuck = globalThis as unknown as { __dbiDuck?: EngineState };

/** DuckDB paths use forward slashes on every OS. */
export function toDuckPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Quote a path as a DuckDB string literal. Paths are server-generated, quoting is defence in depth. */
export function quotePath(p: string): string {
  return `'${toDuckPath(p).replace(/'/g, "''")}'`;
}

/** Memory cap for all queries in this process (DuckDB's default is 80% of RAM). Big sorts spill to disk. */
const MEMORY_LIMIT = /^\d+(\.\d+)?\s*(MB|GB)$/i.test(process.env.DBI_DUCKDB_MEMORY_LIMIT ?? "")
  ? (process.env.DBI_DUCKDB_MEMORY_LIMIT as string)
  : "2GB";

async function createInstance(root: string): Promise<DuckDBInstance> {
  const spillDir = `${root.replace(/\/$/, "")}/_duckdb_tmp`;
  await mkdir(spillDir, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:", { threads: "4" });
  const conn = await instance.connect();
  try {
    await conn.run(`SET memory_limit = '${MEMORY_LIMIT}'`);
    await conn.run(`SET temp_directory = ${quotePath(spillDir)}`);
    await conn.run(`SET allowed_directories = [${quotePath(root.endsWith("/") ? root : `${root}/`)}]`);
    await conn.run("SET enable_external_access = false");
    await conn.run("SET autoinstall_known_extensions = false");
    await conn.run("SET lock_configuration = true");
  } finally {
    conn.closeSync();
  }
  return instance;
}

/** Returns the shared sandboxed instance for `root` (one per process). */
export function getDuck(root: string): Promise<DuckDBInstance> {
  const normalized = toDuckPath(root);
  const current = globalForDuck.__dbiDuck;
  if (current && current.root === normalized) return current.instance;
  const state: EngineState = { root: normalized, instance: createInstance(normalized) };
  globalForDuck.__dbiDuck = state;
  return state.instance;
}

function toPlain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}

export async function withConnection<T>(root: string, fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const conn = await (await getDuck(root)).connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

export async function queryRows(conn: DuckDBConnection, sqlText: string, params: DuckDBValue[] = []): Promise<Row[]> {
  const reader = await conn.runAndReadAll(sqlText, params);
  return reader.getRowObjectsJS().map((row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) out[k] = toPlain(v);
    return out;
  });
}
