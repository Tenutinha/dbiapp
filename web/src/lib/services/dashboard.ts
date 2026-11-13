import "server-only";
import { getDataFilterRaw } from "../data/instances";
import { listFiles } from "../data/repository";
import { parseCross } from "../query/cross";
import { parseFactFilter } from "../query/fact-filter";
import { parseSelection, runDashboard, type DashboardData } from "../query/run";
import { storage } from "../storage";
import type { Template } from "../templates/schema";
import { openingVisuals, withoutHidden } from "../templates/sections";
import { withChosenFields } from "../templates/field-choice";
import { requireTemplate, resolveLocalFiles } from "./datasets";

export interface LoadedDashboard {
  template: Template;
  data: DashboardData;
  totalRows: number;
  /** Analyses left for later (see `opening`): the page asks for each one when the reader gets near it. */
  pending: string[];
}

/** What every load of a dashboard needs: the readers' template, the local files and the data filter. */
async function prepare(instanceId: string, templateId: string, activeVersionId: string, searchParams: Readonly<Record<string, string | string[] | undefined>>) {
  // Analyses taken off the air are neither shown nor computed for readers; swappable tables take the reader’s field.
  const template = withChosenFields(withoutHidden(await requireTemplate(templateId)), searchParams);
  const [files, rawFilter] = await Promise.all([listFiles(activeVersionId), getDataFilterRaw(instanceId)]);
  const factFilter = parseFactFilter(rawFilter, factColumns(template));
  const byTable = Object.fromEntries(files.map((f) => [f.tableName, f.storagePath]));
  const fact = template.tables.find((t) => t.kind === "fact")?.name;
  const totalRows = files.find((f) => f.tableName === fact)?.rowCount ?? 0;
  return { template, factFilter, totalRows, local: await resolveLocalFiles(byTable) };
}

/** The data filter of a dashboard, checked against its fact table (invalid parts are dropped). */
export function factColumns(template: Template): string[] {
  return template.tables.find((t) => t.kind === "fact")?.columns.map((c) => c.name) ?? [];
}

/**
 * Runs the dashboard for the active version of an instance, through its data filter (also on shared
 * links: the filter is read here, never left to the caller). Caller must have checked access.
 */
export async function loadDashboard(
  instanceId: string,
  templateId: string,
  activeVersionId: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  /** "opening": only the first analysis (and the filters) is computed now; the others are left `pending`. */
  how: "whole" | "opening" = "whole",
): Promise<LoadedDashboard> {
  const { template, factFilter, totalRows, local } = await prepare(instanceId, templateId, activeVersionId, searchParams);
  const opening = how === "opening" ? openingVisuals(template) : null;
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
    opening ? { only: opening.only } : {},
  );
  return { template, data, totalRows, pending: opening?.pending ?? [] };
}

/**
 * One analysis of a dashboard, for the page that left it for later: its visuals under the same filters
 * and picked items. Null when the analysis is not one the readers get. Caller must have checked access.
 */
export async function loadAnalysis(
  instanceId: string,
  templateId: string,
  activeVersionId: string,
  analysisId: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Promise<{ template: Template; results: DashboardData["visuals"] } | null> {
  const { template, factFilter, local } = await prepare(instanceId, templateId, activeVersionId, searchParams);
  const analysis = template.analyses.find((a) => a.id === analysisId);
  if (!analysis) return null;
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
    { only: new Set(analysis.visuals), filterOptions: false },
  );
  const byId = new Map(data.visuals.map((r) => [r.visual.id, r]));
  return { template, results: analysis.visuals.flatMap((id) => byId.get(id) ?? []) };
}
