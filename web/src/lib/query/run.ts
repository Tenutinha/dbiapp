/**
 * Executes every visual of a template against a published dataset.
 */
import { queryRows, withConnection, type Row } from "../duck/engine";
import type { Template, Visual } from "../templates/schema";
import { buildFilterOptionsQuery, buildVisualQuery, type FilterSelection, type TableFiles } from "./build";
import type { FactFilter } from "./fact-filter";

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
  /** The dashboard's data filter on its fact table (set in the data manager). */
  factFilter: FactFilter = [],
): Promise<DashboardData> {
  const started = performance.now();
  return withConnection(storageRoot, async (conn) => {
    selection = await resolveSingleFilters(conn, template, files, selection, factFilter);
    const visuals: VisualResult[] = [];
    for (const visual of template.visuals) {
      if (visual.type === "text") {
        visuals.push({ visual, rows: [] });
        continue;
      }
      try {
        const q = buildVisualQuery(template, files, visual, selection, factFilter);
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
        const q = buildFilterOptionsQuery(template, files, fieldId, selection, factFilter);
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

/** Preferred values of a single-choice filter, in order ("2026, 2024" → ["2026", "2024"]). */
export function defaultPreferences(template: Template, fieldId: string): string[] {
  const raw = template.filterDefaults[fieldId];
  return raw === undefined ? [] : raw.split(",").map((v) => v.trim()).filter(Boolean);
}

/**
 * The value a single-choice filter ends up with, given what exists in the data: the user's pick when it
 * exists, else the first preferred value that exists, else the greatest value (e.g. the latest year).
 */
export function chooseSingleValue(options: readonly string[], picked: string | undefined, preferences: readonly string[]): string | undefined {
  if (picked !== undefined && options.includes(picked)) return picked;
  const preferred = preferences.find((p) => options.includes(p));
  if (preferred !== undefined) return preferred;
  return [...options].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).at(-1);
}

/**
 * Settles every single-choice filter against the data, in template order, so each one sees the values
 * already chosen before it (cargo first, then the years that cargo has).
 */
async function resolveSingleFilters(
  conn: Parameters<typeof queryRows>[0], template: Template, files: TableFiles, selection: FilterSelection,
  factFilter: FactFilter,
): Promise<FilterSelection> {
  // Single-choice values start unconfirmed: a provisional year must not hide the cargos that lack it.
  const resolved: Record<string, readonly string[]> = Object.fromEntries(
    Object.entries(selection).filter(([id]) => !(id in template.filterDefaults)),
  );
  for (const fieldId of template.filters) {
    if (!(fieldId in template.filterDefaults)) continue;
    try {
      const q = buildFilterOptionsQuery(template, files, fieldId, resolved, factFilter);
      const options = (await queryRows(conn, q.sql, q.params)).map((r) => r.value).filter((v): v is string => typeof v === "string");
      const chosen = chooseSingleValue(options, selection[fieldId]?.[0], defaultPreferences(template, fieldId));
      resolved[fieldId] = chosen === undefined ? [] : [chosen];
    } catch (err) {
      console.error(`[dashboard] filter ${template.id}/${fieldId} failed`, err);
    }
  }
  return resolved;
}

/**
 * Parses `?f.regiao=Sul&f.regiao=Norte` style search params into a selection.
 * Single-choice filters (template.filterDefaults) keep only the first value; with none, they start at the
 * first preference (runDashboard then checks it against the data).
 */
export function parseSelection(
  template: Template,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): FilterSelection {
  const selection: Record<string, string[]> = {};
  for (const fieldId of template.filters) {
    const raw = searchParams[`f.${fieldId}`];
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => v.slice(0, 200));
    if (fieldId in template.filterDefaults) {
      const first = values[0] ?? defaultPreferences(template, fieldId)[0];
      if (first !== undefined) selection[fieldId] = [first];
    } else if (values.length > 0) selection[fieldId] = values;
  }
  return selection;
}
