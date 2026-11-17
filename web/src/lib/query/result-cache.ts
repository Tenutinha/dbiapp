/**
 * Results of the dashboards' queries, kept in this server's memory.
 *
 * A query names the files it reads, and a data file never changes (every upload gets a new key: publishing
 * again means other files, and so another query). The text of a query and its parameters therefore decide
 * its result for good: the same visual under the same filters is computed once per server, however many
 * times the page is opened, and two requests asking for it at the same time wait for a single run.
 */
import { createHash } from "node:crypto";
import type { Row } from "../duck/engine";

/** Results kept; the one used longest ago goes first. */
const MAX_ENTRIES = 600;
/** A result bigger than this is not kept (a long listing): it would push many small ones out. */
const MAX_ROWS_PER_ENTRY = 5_000;
/** Rows kept in all. */
const MAX_ROWS = 150_000;

interface Entry {
  rows: Promise<Row[]>;
  /** Rows it holds once it has arrived (0 while running). */
  size: number;
}

const entries = new Map<string, Entry>();
let held = 0;

/** One key per text and list of parameters (as JSON: no two different pairs can read the same). */
const keyOf = (sql: string, params: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify([sql, params])).digest("base64");

function drop(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  held -= entry.size;
  entries.delete(key);
}

function trim(): void {
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES && held <= MAX_ROWS) return;
    drop(key);
  }
}

/**
 * The rows of a query: the ones kept for it, or the ones `run` brings (kept for the next time). Each caller
 * gets rows of its own, so nothing a page does to them reaches the next one.
 */
export async function cachedRows(sql: string, params: readonly string[], run: () => Promise<Row[]>): Promise<Row[]> {
  const key = keyOf(sql, params);
  const known = entries.get(key);
  if (known) {
    // Used now: back to the end of the line.
    entries.delete(key);
    entries.set(key, known);
    return (await known.rows).map((row) => ({ ...row }));
  }
  const entry: Entry = { rows: run(), size: 0 };
  entries.set(key, entry);
  try {
    const rows = await entry.rows;
    if (entries.get(key) === entry) {
      if (rows.length > MAX_ROWS_PER_ENTRY) drop(key);
      else {
        entry.size = rows.length;
        held += rows.length;
        trim();
      }
    }
    return rows.map((row) => ({ ...row }));
  } catch (err) {
    // A failure is never kept: the next request tries again.
    if (entries.get(key) === entry) drop(key);
    throw err;
  }
}

/** How many results are kept, and how many rows they hold. */
export function resultCacheSize(): { entries: number; rows: number } {
  return { entries: entries.size, rows: held };
}

/** Forgets everything (the tests start from nothing). */
export function clearResultCache(): void {
  entries.clear();
  held = 0;
}
