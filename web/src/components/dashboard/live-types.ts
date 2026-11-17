import type { CrossPicks, FilterOptions } from "@/lib/query/run";

/** The filters of a dashboard and the items picked in its visuals, as the filter bar shows them. */
export interface FilterData {
  filters: FilterOptions[];
  cross: CrossPicks[];
}

/** One part of the page under a selection; `body` is null when it has nothing to show. */
export type PartAnswer = { ok: true; body: React.ReactNode | null } | { ok: false };

/** The part of a dashboard made of the visuals that belong to no analysis. */
export const LOOSE_PART = "";
