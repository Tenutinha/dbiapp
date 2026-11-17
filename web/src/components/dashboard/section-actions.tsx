"use server";

import { loadFilters, loadParts } from "@/lib/services/dashboard";
import { searchRecord } from "@/lib/search-string";
import { readSectionTicket } from "@/lib/section-ticket";
import { StripCards, VisualGrid, visibleResults } from "./DashboardView";
import type { FilterData } from "./live-types";

export type AnalysisAnswer =
  /** `body` is null when the analysis has nothing to show under these filters. */
  | { ok: true; body: React.ReactNode | null }
  | { ok: false };

/** The bodies in the order the parts were asked for, and the items picked in the visuals under this selection. */
export type PartsAnswer = { ok: true; bodies: (React.ReactNode | null)[]; cross: FilterData["cross"] } | { ok: false };

export type FiltersAnswer = ({ ok: true } & FilterData) | { ok: false };

/** An analysis id, "" for the visuals that belong to none, or one run of an analysis' strip ("analise:3"). */
const PART_ID = /^([a-z_][a-z0-9_]{0,80}(:\d{1,3})?)?$/;
const MAX_PARTS = 60;
const MAX_SEARCH = 8000;

const validSearch = (search: unknown): search is string => typeof search === "string" && search.length <= MAX_SEARCH;

/**
 * The visuals of some parts of a dashboard (analyses the page left for later, or every part on screen after
 * the selection changed), computed side by side. Who may read was decided by the page that issued the
 * ticket; here the ticket is only checked, and it names a single dashboard version.
 */
export async function loadPartsAction(ticket: string, parts: string[], search: string): Promise<PartsAnswer> {
  const grant = readSectionTicket(ticket);
  if (!grant || !validSearch(search)) return { ok: false };
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_PARTS || !parts.every((p) => typeof p === "string" && PART_ID.test(p))) return { ok: false };
  if (new Set(parts).size !== parts.length) return { ok: false };
  try {
    const loaded = await loadParts(grant.instanceId, grant.templateId, grant.activeVersionId, parts, searchRecord(search));
    const bodies = loaded.parts.map((part, i) => {
      if (part === null) return null;
      // A part whose visuals all hid themselves (no rows) is not shown; an analysis without visuals keeps its title.
      const empty = part.results.length > 0 && visibleResults(part.results).length === 0;
      if (empty) return null;
      return part.run
        ? <StripCards key={parts[i]} template={loaded.template} results={visibleResults(part.results)} />
        : <VisualGrid key={parts[i]} template={loaded.template} results={part.results} layout={part.layout} />;
    });
    return { ok: true, bodies, cross: loaded.cross };
  } catch (err) {
    console.error(`[dashboard] parts ${grant.instanceId}/${parts.join(",")} failed`, err);
    return { ok: false };
  }
}

/** One analysis (see loadPartsAction). */
export async function loadAnalysisAction(ticket: string, analysisId: string, search: string): Promise<AnalysisAnswer> {
  if (typeof analysisId !== "string" || analysisId === "") return { ok: false };
  const answer = await loadPartsAction(ticket, [analysisId], search);
  return answer.ok ? { ok: true, body: answer.bodies[0] ?? null } : { ok: false };
}

/** The filters of a dashboard under a selection: their options, what is chosen, and the items picked in the visuals. */
export async function loadFiltersAction(ticket: string, search: string): Promise<FiltersAnswer> {
  const grant = readSectionTicket(ticket);
  if (!grant || !validSearch(search)) return { ok: false };
  try {
    return { ok: true, ...(await loadFilters(grant.instanceId, grant.templateId, grant.activeVersionId, searchRecord(search))) };
  } catch (err) {
    console.error(`[dashboard] filters of ${grant.instanceId} failed`, err);
    return { ok: false };
  }
}
