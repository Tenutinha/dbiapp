/**
 * Executes every visual of a template against a published dataset.
 */
import { queryRows, withConnection, type Row } from "../duck/engine";
import type { Template, Visual } from "../templates/schema";
import { buildFilterOptionsQuery, buildVisualQuery, type FilterSelection, type TableFiles } from "./build";

export interface VisualResult {
  visual: Visual;
  rows: Row[];
  error?: string;
}

export interface FilterOptions {
  fieldId: string;
  label: string;
  values: string[];
  selected: string[];
  /** Exactly one value, always set (template filterDefaults). */
  single: boolean;
}

export interface DashboardData {
  visuals: VisualResult[];
  filters: FilterOptions[];
  elapsedMs: number;
}

export async function runDashboard(
  storageRoot: string,
  template: Template,
  files: TableFiles,
  selection: FilterSelection,
): Promise<DashboardData> {
  const started = performance.now();
  return withConnection(storageRoot, async (conn) => {
    const visuals: VisualResult[] = [];
    for (const visual of template.visuals) {
      if (visual.type === "text") {
        visuals.push({ visual, rows: [] });
        continue;
      }
      try {
        const q = buildVisualQuery(template, files, visual, selection);
        visuals.push({ visual, rows: await queryRows(conn, q.sql, q.params) });
      } catch (err) {
        console.error(`[dashboard] visual ${template.id}/${visual.id} failed`, err);
        visuals.push({ visual, rows: [], error: "Não foi possível calcular este visual." });
      }
    }

    const filters: FilterOptions[] = [];
    for (const fieldId of template.filters) {
      const field = template.fields.find((f) => f.id === fieldId);
      let values: string[] = [];
      try {
        const q = buildFilterOptionsQuery(template, files, fieldId, selection);
        const rows = await queryRows(conn, q.sql, q.params);
        values = rows.map((r) => r.value).filter((v): v is string => typeof v === "string");
      } catch (err) {
        console.error(`[dashboard] filter ${template.id}/${fieldId} failed`, err);
      }
      filters.push({
        fieldId,
        label: field?.label ?? fieldId,
        values,
        selected: [...(selection[fieldId] ?? [])],
        single: fieldId in template.filterDefaults,
      });
    }

    return { visuals, filters, elapsedMs: Math.round(performance.now() - started) };
  });
}

/**
 * Parses `?f.regiao=Sul&f.regiao=Norte` style search params into a selection.
 * Filters with a default (template.filterDefaults) keep only the first value and fall back to the default.
 */
export function parseSelection(
  template: Template,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): FilterSelection {
  const selection: Record<string, string[]> = {};
  for (const fieldId of template.filters) {
    const raw = searchParams[`f.${fieldId}`];
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => v.slice(0, 200));
    const fallback = template.filterDefaults[fieldId];
    if (fallback !== undefined) selection[fieldId] = [values[0] ?? fallback];
    else if (values.length > 0) selection[fieldId] = values;
  }
  return selection;
}
