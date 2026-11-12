"use server";

import { loadAnalysis } from "@/lib/services/dashboard";
import { readSectionTicket } from "@/lib/section-ticket";
import { VisualGrid, visibleResults } from "./DashboardView";

export type AnalysisAnswer =
  /** `body` is null when the analysis has nothing to show under these filters. */
  | { ok: true; body: React.ReactNode | null }
  | { ok: false };

const ANALYSIS_ID = /^[a-z_][a-z0-9_]{0,80}$/;
const MAX_SEARCH = 8000;

/** "f.mes=2026-07&f.mes=2026-06" → { "f.mes": ["2026-07", "2026-06"] }, as a page receives its search params. */
function searchRecord(search: string): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(search)) {
    const held = record[name];
    record[name] = held === undefined ? value : [...(Array.isArray(held) ? held : [held]), value];
  }
  return record;
}

/**
 * The visuals of one analysis the page left for later (LazySection). Who may read was decided by the
 * page that issued the ticket; here the ticket is only checked, and it names a single dashboard version.
 */
export async function loadAnalysisAction(ticket: string, analysisId: string, search: string): Promise<AnalysisAnswer> {
  const grant = readSectionTicket(ticket);
  if (!grant || typeof analysisId !== "string" || !ANALYSIS_ID.test(analysisId)) return { ok: false };
  if (typeof search !== "string" || search.length > MAX_SEARCH) return { ok: false };
  try {
    const loaded = await loadAnalysis(grant.instanceId, grant.templateId, grant.activeVersionId, analysisId, searchRecord(search));
    if (!loaded) return { ok: false };
    // An analysis whose visuals all hid themselves (no rows) is not shown; one without visuals keeps its title.
    const empty = loaded.results.length > 0 && visibleResults(loaded.results).length === 0;
    const layout = loaded.template.analyses.find((a) => a.id === analysisId)?.layout;
    return { ok: true, body: empty ? null : <VisualGrid template={loaded.template} results={loaded.results} layout={layout} /> };
  } catch (err) {
    console.error(`[dashboard] analysis ${grant.instanceId}/${analysisId} failed`, err);
    return { ok: false };
  }
}
