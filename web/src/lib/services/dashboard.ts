import "server-only";
import { listFiles } from "../data/repository";
import { parseSelection, runDashboard, type DashboardData } from "../query/run";
import { storage } from "../storage";
import type { Template } from "../templates/schema";
import { requireTemplate, resolveLocalFiles } from "./datasets";

export interface LoadedDashboard {
  template: Template;
  data: DashboardData;
  totalRows: number;
}

/** Runs the dashboard for the active version of an instance. Caller must have checked access. */
export async function loadDashboard(
  templateId: string,
  activeVersionId: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Promise<LoadedDashboard> {
  const template = await requireTemplate(templateId);
  const files = await listFiles(activeVersionId);
  const byTable = Object.fromEntries(files.map((f) => [f.tableName, f.storagePath]));
  const fact = template.tables.find((t) => t.kind === "fact")?.name;
  const totalRows = files.find((f) => f.tableName === fact)?.rowCount ?? 0;
  const local = await resolveLocalFiles(byTable);
  const data = await runDashboard(storage.workRoot, template, local, parseSelection(template, searchParams));
  return { template, data, totalRows };
}
