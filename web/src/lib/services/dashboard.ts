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
import { lazyLocalFiles, requireTemplate } from "./datasets";

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
  // Asked together: each is a trip to the database, and one after the other they were most of what a click waited for.
  const [stored, files, rawFilter] = await Promise.all([requireTemplate(templateId), listFiles(activeVersionId), getDataFilterRaw(instanceId)]);
  const template = withChosenFields(withoutHidden(stored), searchParams);
  const factFilter = parseFactFilter(rawFilter, factColumns(template));
  const byTable = Object.fromEntries(files.map((f) => [f.tableName, f.storagePath]));
  const fact = template.tables.find((t) => t.kind === "fact")?.name;
  const totalRows = files.find((f) => f.tableName === fact)?.rowCount ?? 0;
  // The files are fetched query by query (only the tables each one reads); where a data file never changes
  // (a bucket: every upload gets a new key) the results are kept too.
  const { files: local, fetchFor } = lazyLocalFiles(byTable);
  return { template, factFilter, totalRows, local, reach: { fetchFor, keep: storage.remote() } };
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
  const { template, factFilter, totalRows, local, reach } = await prepare(instanceId, templateId, activeVersionId, searchParams);
  const opening = how === "opening" ? openingVisuals(template) : null;
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
    opening ? { ...reach, only: opening.only } : reach,
  );
  return { template, data, totalRows, pending: opening?.pending ?? [] };
}

/** The visuals of one part of the page, in its order, and how the part lays them out. */
export interface LoadedPart {
  results: DashboardData["visuals"];
  layout?: "grid" | "row";
}

/**
 * Some parts of a dashboard under one selection, computed in one go (their visuals side by side): the
 * analyses the page left for later, or the ones on screen after a filter or a picked item changed. A part is
 * an analysis id, or "" for the visuals that belong to no analysis; one the readers do not get answers null.
 * The items picked in the visuals come along (no query needed). Caller must have checked access.
 */
export async function loadParts(
  instanceId: string,
  templateId: string,
  activeVersionId: string,
  partIds: readonly string[],
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Promise<{ template: Template; parts: (LoadedPart | null)[]; cross: DashboardData["cross"] }> {
  const { template, factFilter, local, reach } = await prepare(instanceId, templateId, activeVersionId, searchParams);
  const placed = new Set(template.analyses.flatMap((a) => a.visuals));
  const wanted = partIds.map((id): { visuals: string[]; layout?: "grid" | "row" } | null => {
    if (id === "") return { visuals: template.visuals.filter((v) => !placed.has(v.id)).map((v) => v.id) };
    const analysis = template.analyses.find((a) => a.id === id);
    return analysis ? { visuals: analysis.visuals, layout: analysis.layout } : null;
  });
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
    { ...reach, only: new Set(wanted.flatMap((p) => p?.visuals ?? [])), filterOptions: false },
  );
  const byId = new Map(data.visuals.map((r) => [r.visual.id, r]));
  return {
    template,
    parts: wanted.map((p) => p && { results: p.visuals.flatMap((id) => byId.get(id) ?? []), layout: p.layout }),
    cross: data.cross,
  };
}

/** The filters of a dashboard under a selection (their options and what is chosen) and the picked items; no visual is computed. */
export async function loadFilters(
  instanceId: string,
  templateId: string,
  activeVersionId: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Promise<Pick<DashboardData, "filters" | "cross">> {
  const { template, factFilter, local, reach } = await prepare(instanceId, templateId, activeVersionId, searchParams);
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
    { ...reach, only: new Set() },
  );
  return { filters: data.filters, cross: data.cross };
}
