import "server-only";
import { getDataFilterRaw } from "../data/instances";
import { listFiles } from "../data/repository";
import { parseCross } from "../query/cross";
import { parseFactFilter } from "../query/fact-filter";
import { parseSelection, runDashboard, type DashboardData } from "../query/run";
import { storage } from "../storage";
import type { Template } from "../templates/schema";
import { requireTemplate, resolveLocalFiles } from "./datasets";

export interface LoadedDashboard {
  template: Template;
  data: DashboardData;
  totalRows: number;
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
): Promise<LoadedDashboard> {
  const template = await requireTemplate(templateId);
  const [files, rawFilter] = await Promise.all([listFiles(activeVersionId), getDataFilterRaw(instanceId)]);
  const factFilter = parseFactFilter(rawFilter, factColumns(template));
  const byTable = Object.fromEntries(files.map((f) => [f.tableName, f.storagePath]));
  const fact = template.tables.find((t) => t.kind === "fact")?.name;
  const totalRows = files.find((f) => f.tableName === fact)?.rowCount ?? 0;
  const local = await resolveLocalFiles(byTable);
  const data = await runDashboard(
    storage.workRoot, template, local, parseSelection(template, searchParams), factFilter, parseCross(template, searchParams),
  );
  return { template, data, totalRows };
}
