/**
 * Data for the dashboard picker of /<org>/admin ("+ Adicionar dashboard"): a browsable showcase of
 * every published catalog dashboard. Pure helpers, safe on client and server; no SQL or contracts leak.
 */
import type { Template, Visual } from "./templates/schema";

export type VisualKind = Visual["type"];

export interface PickerItem {
  id: string;
  name: string;
  /** Subject, e.g. "Comercial", "Eleições". */
  area: string;
  origin: Template["origin"];
  description: string;
  tables: { name: string; kind: "fact" | "dimension" }[];
  analyses: { title: string; description: string; visuals: number }[];
  /** How many visuals of each kind (kpi, bar, map…) the dashboard has. */
  visualKinds: Partial<Record<VisualKind, number>>;
  visualCount: number;
}

export function toPickerItem(t: Template): PickerItem {
  const visualKinds: Partial<Record<VisualKind, number>> = {};
  for (const v of t.visuals) visualKinds[v.type] = (visualKinds[v.type] ?? 0) + 1;
  return {
    id: t.id,
    name: t.name,
    area: t.area,
    origin: t.origin,
    description: t.description,
    tables: t.tables.map((tb) => ({ name: tb.name, kind: tb.kind })),
    analyses: t.analyses.map((a) => ({ title: a.title, description: a.description, visuals: a.visuals.length })),
    visualKinds,
    visualCount: t.visuals.length,
  };
}

const normalize = (s: string): string => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function haystack(i: PickerItem): string {
  return normalize([i.name, i.area, i.description, ...i.analyses.map((a) => `${a.title} ${a.description}`)].join(" "));
}

/** Every word of `query` must appear in the name, subject, description or an analysis; `area` narrows by subject. */
export function filterPickerItems(items: readonly PickerItem[], query: string, area: string | null): PickerItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return items.filter((i) => (area === null || i.area === area) && words.every((w) => haystack(i).includes(w)));
}

export function areasOf(items: readonly PickerItem[]): string[] {
  return [...new Set(items.map((i) => i.area))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Rows of the showcase: one per subject, alphabetically. */
export function groupByArea(items: readonly PickerItem[]): [string, PickerItem[]][] {
  return areasOf(items).map((area) => [area, items.filter((i) => i.area === area)]);
}

/** Distinct cover hues: violet, cyan, pink, green, orange, blue, amber, red. */
const AREA_HUES = [262, 190, 330, 150, 25, 215, 45, 0] as const;

/** One cover hue per subject, assigned in alphabetical order so subjects never share a colour (up to 8). */
export function areaHues(items: readonly PickerItem[]): Map<string, number> {
  return new Map(areasOf(items).map((area, i) => [area, AREA_HUES[i % AREA_HUES.length]]));
}
