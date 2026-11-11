/** Files per "Organizar" request: each request moves file by file, so it must end well within the route's time limit. */
export const ORGANIZE_BATCH_SIZE = 100;

interface BatchableMove {
  path: string;
  /** Destination folder. Copies of the same document always share it. */
  to: string;
}

/**
 * Splits the chosen moves into requests of about `size` paths. Moves to the same destination folder stay in
 * one request, so the server can still refuse two copies of the same document chosen together.
 */
export function organizeBatches(moves: readonly BatchableMove[], chosen: ReadonlySet<string>, size: number = ORGANIZE_BATCH_SIZE): string[][] {
  const groups = new Map<string, string[]>();
  for (const m of moves) {
    if (!chosen.has(m.path)) continue;
    groups.set(m.to, [...(groups.get(m.to) ?? []), m.path]);
  }
  const batches: string[][] = [];
  let current: string[] = [];
  for (const group of groups.values()) {
    current = [...current, ...group];
    if (current.length >= size) {
      batches.push(current);
      current = [];
    }
  }
  return current.length > 0 ? [...batches, current] : batches;
}
