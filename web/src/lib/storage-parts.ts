/**
 * A table of a dataset version is one Parquet file or several ("parts": one per source file, e.g. one per
 * year), read together as one table. The parts travel in the single path a table has
 * (dataset_files.storage_path, and the local paths handed to the queries), one per line — a storage key
 * never holds a line break, and a path with no line break is a table of one part, as it always was.
 */
const SEPARATOR = "\n";

export function joinParts(paths: readonly string[]): string {
  return paths.join(SEPARATOR);
}

export function splitParts(path: string): string[] {
  return path.split(SEPARATOR).filter((p) => p !== "");
}

/** Files of the version being replaced that the new one does not use any more (each part is one key). */
export function supersededParts(previous: readonly string[], current: readonly string[]): string[] {
  const kept = new Set(current.flatMap(splitParts));
  return [...new Set(previous.flatMap(splitParts))].filter((p) => !kept.has(p));
}
