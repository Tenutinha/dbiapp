/**
 * The dashboard's structure as the edit table shows it: the summary's topics, each analysis under its
 * topic, and what each analysis uses — the files (tables) it reads, its charts, its fields and measures.
 * Pure: safe in client components and unit tested.
 */
import type { Analysis, Template, Visual } from "./schema";

export interface UsedItem {
  id: string;
  label: string;
  kind: "field" | "measure";
}

export interface StructureRow {
  analysis: Analysis;
  /** Position in the summary (1-based, hidden ones skipped), or null when not listed / hidden. */
  number: number | null;
  tables: string[];
  visuals: Visual[];
  used: UsedItem[];
}

export interface StructureGroup {
  /** Topic title; null for the analyses the summary does not list. */
  title: string | null;
  /** Index of the topic in `template.summary` (null for the unlisted block). */
  index: number | null;
  rows: StructureRow[];
}

/** Field and measure ids a chart points to. */
export function visualRefs(v: Visual): { fields: string[]; measures: string[]; sql: string[] } {
  const where = v.where ? [v.where] : [];
  switch (v.type) {
    case "kpi":
      return { fields: [], measures: [v.measure, ...(v.detail?.measure ? [v.detail.measure] : [])], sql: where };
    case "bar":
    case "line":
      return { fields: [v.field], measures: v.measures, sql: where };
    case "donut":
      return { fields: [v.field], measures: [v.measure], sql: where };
    case "table":
      return { fields: v.fields, measures: v.measures, sql: where };
    case "map": {
      const c = v.color;
      const measures = c.mode === "category"
        ? [c.measure, c.colorMeasure, ...(c.strengthMeasure ? [c.strengthMeasure] : [])]
        : [c.measure];
      return { fields: [v.field, ...(v.labelField ? [v.labelField] : [])], measures: [...measures, ...v.tooltip], sql: where };
    }
    case "rows":
      return { fields: [], measures: [], sql: [...where, ...v.columns.map((c) => c.sql), ...(v.orderBy ? [v.orderBy] : [])] };
    case "text":
      return { fields: [], measures: [], sql: [] };
    case "statement":
      return {
        fields: [...v.levels, v.column],
        measures: [v.measure],
        sql: [...where, ...v.lines.flatMap((l) => (l.where ? [l.where] : []))],
      };
  }
}

const unique = <T,>(list: readonly T[]): T[] => [...new Set(list)];

/** Table names an SQL expression mentions ("registros.valor" → registros), among the template's tables. */
export function tablesIn(sql: string, tableNames: readonly string[]): string[] {
  const known = new Set(tableNames);
  const found = [...sql.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\./g)].map((m) => m[1]);
  return unique(found.filter((t) => known.has(t)));
}

/** Files, fields and measures one analysis uses (through its charts). */
export function analysisUsage(t: Template, a: Analysis): Pick<StructureRow, "tables" | "visuals" | "used"> {
  const visuals = a.visuals.flatMap((id) => t.visuals.filter((v) => v.id === id));
  const tableNames = t.tables.map((tb) => tb.name);
  const mainFact = t.tables.find((tb) => tb.kind === "fact")?.name;
  const fields = new Map(t.fields.map((f) => [f.id, f]));
  const measures = new Map(t.measures.map((m) => [m.id, m]));

  const used: UsedItem[] = [];
  const sql: string[] = [];
  const tables: string[] = [];
  for (const v of visuals) {
    const refs = visualRefs(v);
    for (const id of refs.fields) {
      const f = fields.get(id);
      if (f) {
        used.push({ id, label: f.label || id, kind: "field" });
        sql.push(f.sql);
      }
    }
    for (const id of refs.measures) {
      const m = measures.get(id);
      if (m) {
        used.push({ id, label: m.label || id, kind: "measure" });
        sql.push(m.sql);
      }
    }
    sql.push(...refs.sql);
    if (v.type !== "text") tables.push(v.fact ?? mainFact ?? "");
  }
  const allTables = unique([...tables, ...sql.flatMap((s) => tablesIn(s, tableNames))]).filter((x) => x !== "");
  return {
    tables: tableNames.filter((n) => allTables.includes(n)),
    visuals,
    used: unique(used.map((u) => `${u.kind}:${u.id}`)).map((key) => used.find((u) => `${u.kind}:${u.id}` === key) as UsedItem),
  };
}

/** The edit table: summary topics in order, then the analyses the summary does not list. */
export function buildStructure(t: Template): StructureGroup[] {
  const byId = new Map(t.analyses.map((a) => [a.id, a]));
  let n = 0;
  const numberOf = (a: Analysis): number | null => (a.hidden ? null : ++n);
  const row = (a: Analysis, number: number | null): StructureRow => ({ analysis: a, number, ...analysisUsage(t, a) });

  const listed = new Set<string>();
  const groups: StructureGroup[] = t.summary.map((g, index) => ({
    title: g.title,
    index,
    rows: g.analyses.flatMap((id) => {
      const a = byId.get(id);
      if (!a) return [];
      listed.add(id);
      return [row(a, numberOf(a))];
    }),
  }));
  const rest = t.analyses.filter((a) => !listed.has(a.id));
  if (rest.length > 0) groups.push({ title: null, index: null, rows: rest.map((a) => row(a, null)) });
  return groups;
}

/** Charts outside every analysis (shown before the first one on the page). */
export function looseVisuals(t: Template): Visual[] {
  const placed = new Set(t.analyses.flatMap((a) => a.visuals));
  return t.visuals.filter((v) => !placed.has(v.id));
}
