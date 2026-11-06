/**
 * Immutable state operations for the sidebar editor. Pure, unit-tested.
 */
import type { LayoutDraft, TocGroup } from "./toc";

export interface EdItem {
  id: string;
  name: string;
  description: string;
  published: boolean;
}

export interface EdGroup {
  /** Stable key for React and drag targets. */
  key: string;
  /** null for new sections and for the unsectioned group. */
  id: string | null;
  title: string;
  ungrouped: boolean;
  items: EdItem[];
}

export const UNGROUPED_KEY = "__ungrouped";

export function fromToc(toc: readonly TocGroup[]): EdGroup[] {
  const toItems = (g: TocGroup | undefined): EdItem[] =>
    (g?.items ?? []).map((i) => ({ id: i.id, name: i.name, description: i.description ?? "", published: i.published }));
  return [
    { key: UNGROUPED_KEY, id: null, title: "", ungrouped: true, items: toItems(toc.find((g) => g.section === null)) },
    ...toc
      .filter((g) => g.section !== null)
      .map((g) => ({ key: g.section!.id, id: g.section!.id, title: g.section!.title, ungrouped: false, items: toItems(g) })),
  ];
}

export function toDraft(groups: readonly EdGroup[]): LayoutDraft {
  const ungrouped = groups.find((g) => g.ungrouped);
  return {
    ungrouped: ungrouped?.items.map((i) => i.id) ?? [],
    sections: groups.filter((g) => !g.ungrouped).map((g) => ({ id: g.id, title: g.title, items: g.items.map((i) => i.id) })),
    dashboards: groups.flatMap((g) => g.items.map((i) => ({ id: i.id, name: i.name, description: i.description }))),
  };
}

function locate(groups: readonly EdGroup[], itemId: string): { g: number; i: number } | null {
  for (let g = 0; g < groups.length; g++) {
    const i = groups[g].items.findIndex((it) => it.id === itemId);
    if (i >= 0) return { g, i };
  }
  return null;
}

/** Moves an item to `toKey` at `toIndex` (clamped; index is computed after removal). */
export function moveItem(groups: readonly EdGroup[], itemId: string, toKey: string, toIndex: number): EdGroup[] {
  const from = locate(groups, itemId);
  const target = groups.findIndex((g) => g.key === toKey);
  if (!from || target < 0) return [...groups];
  const item = groups[from.g].items[from.i];
  const removed = groups.map((g, gi) => (gi === from.g ? { ...g, items: g.items.filter((it) => it.id !== itemId) } : g));
  return removed.map((g, gi) => {
    if (gi !== target) return g;
    const at = Math.max(0, Math.min(toIndex, g.items.length));
    return { ...g, items: [...g.items.slice(0, at), item, ...g.items.slice(at)] };
  });
}

/** Up/down by one slot; crosses into the neighbouring group at the edges. */
export function nudgeItem(groups: readonly EdGroup[], itemId: string, dir: -1 | 1): EdGroup[] {
  const at = locate(groups, itemId);
  if (!at) return [...groups];
  const group = groups[at.g];
  const inside = at.i + dir;
  if (inside >= 0 && inside < group.items.length) return moveItem(groups, itemId, group.key, inside);
  const neighbour = groups[at.g + dir];
  if (!neighbour) return [...groups];
  return moveItem(groups, itemId, neighbour.key, dir === -1 ? neighbour.items.length : 0);
}

export function updateItem(groups: readonly EdGroup[], itemId: string, patch: Partial<Pick<EdItem, "name" | "description">>): EdGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
}

export function addSection(groups: readonly EdGroup[], key: string, title = "Nova seção"): EdGroup[] {
  return [...groups, { key, id: null, title, ungrouped: false, items: [] }];
}

export function renameSection(groups: readonly EdGroup[], key: string, title: string): EdGroup[] {
  return groups.map((g) => (g.key === key ? { ...g, title } : g));
}

/** Removing a section keeps its dashboards: they move to the end of the unsectioned group. */
export function removeSection(groups: readonly EdGroup[], key: string): EdGroup[] {
  const section = groups.find((g) => g.key === key && !g.ungrouped);
  if (!section) return [...groups];
  return groups
    .filter((g) => g.key !== key)
    .map((g) => (g.ungrouped ? { ...g, items: [...g.items, ...section.items] } : g));
}

/** Moves a section up/down among sections (the unsectioned group always stays first). */
export function nudgeSection(groups: readonly EdGroup[], key: string, dir: -1 | 1): EdGroup[] {
  const i = groups.findIndex((g) => g.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= groups.length || groups[i].ungrouped || groups[j].ungrouped) return [...groups];
  const next = [...groups];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
