/**
 * Editing helpers for the dashboard registration form. Pure and immutable: every function
 * returns a new template (or list) and never touches its input. Safe in client components.
 */
import type { Template, TemplateTable, Visual } from "./schema";

export type VisualType = Visual["type"];

const stripAccents = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "Força da vitória" → "forca_da_vitoria" (valid identifier for fields, measures, visuals…). */
export function toSnakeId(label: string): string {
  const id = stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(id) ? `x${id}` : id;
}

/** "Eleição Presidencial 2026" → "eleicao-presidencial-2026" (dashboard id). */
export function toKebabId(label: string): string {
  return stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `wanted`, or `wanted_2`, `wanted_3`… — the first one not in `taken`. */
export function uniqueId(wanted: string, taken: readonly string[]): string {
  const root = wanted || "item";
  if (!taken.includes(root)) return root;
  let n = 2;
  while (taken.includes(`${root}_${n}`)) n += 1;
  return `${root}_${n}`;
}

export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((current, i) => (i === index ? item : current));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Moves the item at `from` to position `to`; out-of-range moves return an unchanged copy. */
export function moveAt<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function emptyTable(name: string, kind: TemplateTable["kind"]): TemplateTable {
  return { name, kind, description: "", columns: [{ name: "id", type: "integer", required: true }] };
}

export function emptyTemplate(): Template {
  return {
    id: "",
    version: 1,
    name: "",
    area: "",
    origin: "powerbi",
    description: "",
    tables: [emptyTable("fato", "fact")],
    relationships: [],
    fields: [],
    measures: [],
    filters: [],
    filterDefaults: {},
    visuals: [],
    analyses: [],
    summary: [],
  };
}

/** A new visual of `type` with every property its type needs (references still empty). */
export function defaultVisual(type: VisualType, id: string, title: string): Visual {
  const base = { id, title, span: 12 };
  switch (type) {
    case "kpi":
      return { ...base, span: 3, type, measure: "" };
    case "bar":
    case "line":
      return { ...base, type, field: "", measures: [], sort: "field", limit: 100, horizontal: false };
    case "donut":
      return { ...base, span: 6, type, field: "", measure: "", limit: 8 };
    case "table":
      return { ...base, type, fields: [], measures: [], limit: 20 };
    case "map":
      return { ...base, type, geo: "uf", field: "", color: { mode: "scale", measure: "", scheme: "sequential" }, tooltip: [] };
    case "rows":
      return { ...base, type, columns: [], limit: 100 };
    case "text":
      return { ...base, type, body: "" };
  }
}

/** Removes a visual and takes it out of the analysis that showed it. */
export function removeVisual(t: Template, visualId: string): Template {
  return {
    ...t,
    visuals: t.visuals.filter((v) => v.id !== visualId),
    analyses: t.analyses.map((a) => ({ ...a, visuals: a.visuals.filter((v) => v !== visualId) })),
  };
}

/** Removes an analysis and takes it out of the summary (groups left empty disappear). */
export function removeAnalysis(t: Template, analysisId: string): Template {
  return {
    ...t,
    analyses: t.analyses.filter((a) => a.id !== analysisId),
    summary: t.summary
      .map((g) => ({ ...g, analyses: g.analyses.filter((a) => a !== analysisId) }))
      .filter((g) => g.analyses.length > 0),
  };
}

/** Removes a file (table) and every relationship that touches it. */
export function removeTable(t: Template, tableName: string): Template {
  return {
    ...t,
    tables: t.tables.filter((tb) => tb.name !== tableName),
    relationships: t.relationships.filter((r) => r.from.table !== tableName && r.to.table !== tableName),
  };
}

export interface UsedIds {
  fields: Set<string>;
  measures: Set<string>;
}

/** Fields and measures referenced by visuals and filters (their ids must not change while in use). */
export function usedIds(t: Template): UsedIds {
  const fields = new Set<string>(t.filters);
  const measures = new Set<string>();
  for (const v of t.visuals) {
    switch (v.type) {
      case "kpi":
        measures.add(v.measure);
        break;
      case "bar":
      case "line":
        fields.add(v.field);
        v.measures.forEach((m) => measures.add(m));
        break;
      case "donut":
        fields.add(v.field);
        measures.add(v.measure);
        break;
      case "table":
        v.fields.forEach((f) => fields.add(f));
        v.measures.forEach((m) => measures.add(m));
        break;
      case "map":
        fields.add(v.field);
        if (v.labelField) fields.add(v.labelField);
        measures.add(v.color.measure);
        if (v.color.mode === "category") {
          measures.add(v.color.colorMeasure);
          if (v.color.strengthMeasure) measures.add(v.color.strengthMeasure);
        }
        v.tooltip.forEach((m) => measures.add(m));
        break;
      case "rows":
      case "text":
        break;
    }
  }
  return { fields, measures };
}

const same = (a: Template, b: Template): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What gets sent to the server: texts trimmed, empty summary groups dropped and, when editing
 * (`stored` given), the version raised above the stored one if anything changed.
 */
export function prepareForSave(t: Template, stored: Template | null): Template {
  const cleaned: Template = {
    ...t,
    name: t.name.trim(),
    area: t.area.trim(),
    description: t.description.trim(),
    summary: t.summary.filter((g) => g.analyses.length > 0).map((g) => ({ ...g, title: g.title.trim() })),
  };
  if (!stored) return cleaned;
  const unchanged = same({ ...cleaned, version: stored.version }, stored);
  if (unchanged) return { ...cleaned, version: stored.version };
  return { ...cleaned, version: Math.max(cleaned.version, stored.version + 1) };
}
