import "server-only";
import { sql } from "../db";
import type { FileFacts } from "../storage-analysis";

/**
 * Memory of the file explorer's analysis (migration 013). Every function tolerates a database where the
 * migration has not run yet: reads come back empty and writes are skipped — the explorer then analyses
 * files again on each view, which is slower but correct.
 */

export interface StoredAnalysis {
  key: string;
  sizeBytes: number;
  /** ISO date of the file when it was analysed (or null when storage gave none). */
  updatedAt: string | null;
  facts: FileFacts;
}

/** 42P01 = undefined table: migration 013 is missing on this database. */
const missingTable = (err: unknown): boolean => (err as { code?: string }).code === "42P01";

async function tolerant<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (missingTable(err)) return fallback;
    throw err;
  }
}

export function readAnalyses(orgId: string, keys: readonly string[]): Promise<StoredAnalysis[]> {
  if (keys.length === 0) return Promise.resolve([]);
  return tolerant(async () => {
    const rows = await sql<{ key: string; sizeBytes: number; updatedAt: Date | null; facts: FileFacts }[]>`
      SELECT storage_key AS key, size_bytes::float8 AS "sizeBytes", file_updated_at AS "updatedAt", facts
      FROM storage_file_analysis
      WHERE organization_id = ${orgId} AND storage_key IN ${sql(keys as string[])}`;
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null }));
  }, []);
}

export function saveAnalyses(orgId: string, rows: readonly StoredAnalysis[]): Promise<void> {
  if (rows.length === 0) return Promise.resolve();
  return tolerant(async () => {
    const values = rows.map((r) => ({
      organization_id: orgId,
      storage_key: r.key,
      size_bytes: r.sizeBytes,
      file_updated_at: r.updatedAt,
      facts: sql.json(r.facts as unknown as Parameters<typeof sql.json>[0]),
    }));
    await sql`
      INSERT INTO storage_file_analysis ${sql(values, "organization_id", "storage_key", "size_bytes", "file_updated_at", "facts")}
      ON CONFLICT (organization_id, storage_key) DO UPDATE SET
        size_bytes = EXCLUDED.size_bytes, file_updated_at = EXCLUDED.file_updated_at,
        facts = EXCLUDED.facts, analyzed_at = now()`;
  }, undefined);
}

/** A file (or every file under a folder prefix ending in "/") changed address: its analysis goes along. */
export function moveAnalyses(orgId: string, from: string, to: string): Promise<void> {
  return tolerant(async () => {
    if (from.endsWith("/")) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM storage_file_analysis WHERE organization_id = ${orgId} AND starts_with(storage_key, ${to})`;
        await tx`
          UPDATE storage_file_analysis SET storage_key = ${to} || substr(storage_key, char_length(${from}) + 1)
          WHERE organization_id = ${orgId} AND starts_with(storage_key, ${from})`;
      });
    } else {
      await sql`DELETE FROM storage_file_analysis WHERE organization_id = ${orgId} AND storage_key = ${to}`;
      await sql`UPDATE storage_file_analysis SET storage_key = ${to} WHERE organization_id = ${orgId} AND storage_key = ${from}`;
    }
  }, undefined);
}

/** Forgets files (or everything under folder prefixes ending in "/"). */
export function forgetAnalyses(orgId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return tolerant(async () => {
    for (const key of keys) {
      if (key.endsWith("/")) await sql`DELETE FROM storage_file_analysis WHERE organization_id = ${orgId} AND starts_with(storage_key, ${key})`;
      else await sql`DELETE FROM storage_file_analysis WHERE organization_id = ${orgId} AND storage_key = ${key}`;
    }
  }, undefined);
}
