import type { PartAnswer } from "./live-types";

/** One part of the page waiting for its numbers under a selection. */
export interface PartRequest {
  part: string;
  search: string;
  resolve: (answer: PartAnswer) => void;
}

/** Parts asked for in one call: the same selection, each part once. */
export interface PartBatch {
  search: string;
  parts: string[];
  /** One entry per part, in the order of `parts`; a part asked twice answers both. */
  requests: { resolve: (answer: PartAnswer) => void }[];
}

/**
 * Groups the requests that came together into one call per selection: the server computes the analyses on
 * screen side by side instead of one request after the other. Pure.
 */
export function planBatches(waiting: readonly PartRequest[]): PartBatch[] {
  const bySearch = new Map<string, Map<string, ((answer: PartAnswer) => void)[]>>();
  for (const r of waiting) {
    const parts = bySearch.get(r.search) ?? new Map<string, ((answer: PartAnswer) => void)[]>();
    parts.set(r.part, [...(parts.get(r.part) ?? []), r.resolve]);
    bySearch.set(r.search, parts);
  }
  return [...bySearch].map(([search, parts]) => ({
    search,
    parts: [...parts.keys()],
    requests: [...parts.values()].map((resolvers) => ({ resolve: (answer: PartAnswer) => resolvers.forEach((resolve) => resolve(answer)) })),
  }));
}
