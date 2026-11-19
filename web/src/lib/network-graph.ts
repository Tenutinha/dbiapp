/**
 * Turns the rows of a network visual (one per pair of places and kind of relationship) into the places and
 * the arcs the 3D map draws. Pure: no I/O, unit-tested directly.
 */
import type { NetworkVisual } from "./templates/schema";

export type NetworkRow = Readonly<Record<string, string | number | boolean | null>>;

type End = NetworkVisual["source"];

export interface NetworkPartner {
  id: string;
  label: string;
  value: number;
}

export interface NetworkNode {
  id: string;
  label: string;
  kind: string;
  detail: string | null;
  lon: number;
  lat: number;
  /** Sum of the measure of the relationships leaving / reaching the place. */
  out: number;
  in: number;
  /** Places it relates to, the largest first. */
  partners: NetworkPartner[];
}

export interface NetworkEdge {
  /** Unique within the graph (source, target and category). */
  key: string;
  source: string;
  target: string;
  category: string | null;
  value: number;
  /** The row it came from, for the measures of its tooltip. */
  row: NetworkRow;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Kinds of place and of relationship, in order of size (the largest first). */
  kinds: string[];
  categories: string[];
  /** Rows left out because a place had no valid coordinates. */
  skipped: number;
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** A number out of a cell (fields come as text): null when it is not a finite number. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function validCoords(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

const byValueDesc = <T,>(totals: ReadonlyMap<T, number>): T[] => [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

interface Draft {
  node: Omit<NetworkNode, "partners">;
  partners: Map<string, NetworkPartner>;
}

export function buildNetwork(visual: NetworkVisual, rows: readonly NetworkRow[]): NetworkGraph {
  const drafts = new Map<string, Draft>();
  const edges = new Map<string, NetworkEdge>();
  const kindTotals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();
  let skipped = 0;

  /** The place at one end of a row, made but not kept yet (a row with one bad end adds no place). */
  const locate = (end: End, row: NetworkRow): Draft | null => {
    const id = text(row[end.id]);
    const lat = toNumber(row[end.lat]);
    const lon = toNumber(row[end.lon]);
    if (!id || !validCoords(lat, lon) || lon === null) return null;
    return drafts.get(id) ?? {
      node: {
        id, label: text(row[end.label]) || id, kind: text(row[end.kind]) || "Outros",
        detail: end.detail ? text(row[end.detail]) || null : null, lat, lon, out: 0, in: 0,
      },
      partners: new Map(),
    };
  };
  const keep = (draft: Draft): Draft => {
    const known = drafts.get(draft.node.id);
    if (known) return known;
    drafts.set(draft.node.id, draft);
    return draft;
  };
  const relate = (from: Draft, to: Draft, value: number): void => {
    const known = from.partners.get(to.node.id);
    from.partners.set(to.node.id, { id: to.node.id, label: to.node.label, value: (known?.value ?? 0) + value });
  };

  for (const row of rows) {
    const foundFrom = locate(visual.source, row);
    const foundTo = locate(visual.target, row);
    if (!foundFrom || !foundTo) {
      skipped += 1;
      continue;
    }
    const from = keep(foundFrom);
    const to = keep(foundTo);
    const value = Math.max(0, toNumber(row[visual.measure]) ?? 0);
    const category = visual.category ? text(row[visual.category]) || "Outros" : null;
    from.node.out += value;
    to.node.in += value;
    if (from !== to) {
      relate(from, to, value);
      relate(to, from, value);
    }
    if (category !== null) categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + value);
    const key = `${from.node.id}→${to.node.id}·${category ?? ""}`;
    const known = edges.get(key);
    // The query groups by these fields, so a repeated key only comes from places whose name or position vary.
    edges.set(key, known ? { ...known, value: known.value + value } : { key, source: from.node.id, target: to.node.id, category, value, row });
  }

  const nodes = [...drafts.values()].map(({ node, partners }) => {
    kindTotals.set(node.kind, (kindTotals.get(node.kind) ?? 0) + node.out + node.in);
    return { ...node, partners: [...partners.values()].sort((a, b) => b.value - a.value) };
  });
  return { nodes, edges: [...edges.values()], kinds: byValueDesc(kindTotals), categories: byValueDesc(categoryTotals), skipped };
}

/** Throughput of a place: what leaves plus what arrives. */
export const throughput = (n: Pick<NetworkNode, "in" | "out">): number => n.in + n.out;

/** The places and arcs touching a place (itself included): what stays lit while it is hovered or picked. */
export function neighbourhood(graph: Pick<NetworkGraph, "edges">, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  for (const e of graph.edges) {
    if (e.source !== id && e.target !== id) continue;
    edges.add(e.key);
    nodes.add(e.source);
    nodes.add(e.target);
  }
  return { nodes, edges };
}

/** Bounding box [[west, south], [east, north]] of the places, padded so none sits on the edge. */
export function boundsOf(nodes: readonly Pick<NetworkNode, "lon" | "lat">[]): [[number, number], [number, number]] | null {
  if (nodes.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of nodes) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  // A single place (or all in one city) still gets a region around it.
  const padLon = Math.max((e - w) * 0.08, 1.5);
  const padLat = Math.max((n - s) * 0.08, 1.5);
  return [[w - padLon, s - padLat], [e + padLon, n + padLat]];
}
