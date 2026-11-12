/**
 * Executes every visual of a template against a published dataset.
 */
import { queryRows, withConnection, type Row } from "../duck/engine";
import type { Template, Visual } from "../templates/schema";
import {
  buildFilterOptionsQuery, buildTableTotalQuery, buildVisualQuery, MissingFactError, type FilterSelection, type TableFiles,
} from "./build";
import type { CrossSelection } from "./cross";
import type { FactFilter } from "./fact-filter";

export interface VisualResult {
  visual: Visual;
  rows: Row[];
  /** A table's line of totals (measure id → value), when the visual asks for one. */
  total?: Row;
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

/** Values picked in one visual, with the labels the filter panel shows. */
export interface CrossPicks {
  visualId: string;
  fieldId: string;
  values: string[];
  label: string;
  visualTitle: string;
}

export interface DashboardData {
  visuals: VisualResult[];
  filters: FilterOptions[];
  cross: CrossPicks[];
  elapsedMs: number;
}

/** Queries of one page running at the same time, each on its own connection (DuckDB shares its threads among them). */
const CONCURRENCY = 6;

/** Runs `job` over every item, a few at a time, each worker with a connection of its own; results keep the items' order. */
async function inParallel<T, R>(
  storageRoot: string, items: readonly T[], job: (conn: Parameters<typeof queryRows>[0], item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = (): Promise<void> => withConnection(storageRoot, async (conn) => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await job(conn, items[i]);
    }
  });
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

export async function runDashboard(
  storageRoot: string,
  template: Template,
  files: TableFiles,
  selection: FilterSelection,
  /** The dashboard's data filter on its fact table (set in the data manager). */
  factFilter: FactFilter = [],
  /** Items picked in the visuals (cross-filtering). */
  cross: CrossSelection = [],
  /** A part of the page: only these visuals, and the filter options only when asked. Default: everything. */
  part: { only?: ReadonlySet<string>; filterOptions?: boolean } = {},
): Promise<DashboardData> {
  const started = performance.now();
  const resolved = await withConnection(storageRoot, (conn) => resolveSingleFilters(conn, template, files, selection, factFilter));
  // Visuals and filter options do not depend on each other: they run side by side, a few at a time.
  const runVisual = async (conn: Parameters<typeof queryRows>[0], visual: Visual): Promise<VisualResult> => {
    if (visual.type === "text") return { visual, rows: [] };
    try {
      const q = buildVisualQuery(template, files, visual, resolved, factFilter, cross);
      const rows = await queryRows(conn, q.sql, q.params);
      if (visual.type !== "table" || !visual.total || rows.length === 0) return { visual, rows };
      const totals = buildTableTotalQuery(template, files, visual, resolved, factFilter, cross);
      return { visual, rows, total: (await queryRows(conn, totals.sql, totals.params))[0] };
    } catch (err) {
      // An extra fact that has no data yet: nothing to show, not a failure.
      if (err instanceof MissingFactError) return { visual, rows: [] };
      console.error(`[dashboard] visual ${template.id}/${visual.id} failed`, err);
      return { visual, rows: [], error: "Não foi possível calcular este visual." };
    }
  };
  const runFilter = async (conn: Parameters<typeof queryRows>[0], fieldId: string): Promise<FilterOptions> => {
    const field = template.fields.find((f) => f.id === fieldId);
    let values: string[] = [];
    try {
      const q = buildFilterOptionsQuery(template, files, fieldId, resolved, factFilter, cross);
      const rows = await queryRows(conn, q.sql, q.params);
      values = rows.map((r) => r.value).filter((v): v is string => typeof v === "string");
    } catch (err) {
      console.error(`[dashboard] filter ${template.id}/${fieldId} failed`, err);
    }
    return {
      fieldId,
      label: field?.label ?? fieldId,
      values,
      selected: [...(resolved[fieldId] ?? [])],
      single: fieldId in template.filterDefaults,
    };
  };
  const wanted = part.only ? template.visuals.filter((v) => part.only?.has(v.id)) : template.visuals;
  const [visuals, filters] = await Promise.all([
    inParallel(storageRoot, wanted, runVisual),
    inParallel(storageRoot, part.filterOptions === false ? [] : template.filters, runFilter),
  ]);

  const picks: CrossPicks[] = cross.map((entry) => ({
    ...entry,
    values: [...entry.values],
    label: template.fields.find((f) => f.id === entry.fieldId)?.label ?? entry.fieldId,
    visualTitle: template.visuals.find((v) => v.id === entry.visualId)?.title ?? entry.visualId,
  }));
  return { visuals, filters, cross: picks, elapsedMs: Math.round(performance.now() - started) };
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
