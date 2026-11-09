/**
 * Pure part of "import from storage": which files of a folder feed which contract tables.
 */
import type { BrowseEntryFile } from "../storage-browse";

export interface FolderMatch {
  table: string;
  fileName: string;
  /** Full storage key (comes from the server's own listing, never from the request). */
  key: string;
  sizeBytes: number;
}

/** Parquet wins over CSV when a folder has both for the same table. */
const EXTENSIONS = ["parquet", "csv"] as const;

export function matchFolderFiles(
  tables: readonly string[],
  files: readonly BrowseEntryFile[],
): { matches: FolderMatch[]; missing: string[] } {
  const matches: FolderMatch[] = [];
  const missing: string[] = [];
  for (const table of tables) {
    const file = EXTENSIONS.map((ext) => files.find((f) => f.name.toLowerCase() === `${table}.${ext}`)).find(Boolean);
    if (file) matches.push({ table, fileName: file.name, key: file.key, sizeBytes: file.sizeBytes });
    else missing.push(table);
  }
  return { matches, missing };
}
