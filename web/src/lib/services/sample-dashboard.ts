import "server-only";
import { parseSelection, runDashboard } from "../query/run";
import { ensureSampleFiles } from "../samples/files";
import { storage } from "../storage";
import type { Template } from "../templates/schema";
import type { LoadedDashboard } from "./dashboard";

/**
 * Runs a template over fictitious sample data, generated on first use: the preview of a ready-made
 * dashboard before anyone uploads a file. No organization data is involved.
 */
export async function loadSampleDashboard(
  template: Template,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Promise<LoadedDashboard> {
  const sample = await ensureSampleFiles(storage.workRoot, template);
  const selection = parseSelection(template, searchParams);
  const data = await runDashboard(storage.workRoot, template, { ...sample.files }, selection);
  return { template, data, totalRows: sample.factRows };
}
