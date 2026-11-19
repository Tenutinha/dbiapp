/**
 * The lines of a "tree" visual (TreeTable.tsx draws them): the leaves the query brings, added up into each
 * group above them. Pure.
 */
import { MISSING_LABEL } from "@/lib/query/labels";

export interface TreeNode {
  key: string;
  label: string;
  depth: number;
  /** One value per column: the sum of the leaves under the line. */
  values: number[];
  children: TreeNode[];
  /** The smallest leaf label under it (the first account code): the order of the chart of accounts. */
  first: string;
}

export interface VisibleRow {
  node: TreeNode;
  depth: number;
  open: boolean;
  /** The line's own text holds what was searched for. */
  match: boolean;
}

const num = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const byChart = (a: TreeNode, b: TreeNode): number => a.first.localeCompare(b.first, "pt-BR", { numeric: true });

/** The path of a leaf: its level values, without the empty ones and those that repeat the level above. */
function pathOf(levels: readonly string[], row: Readonly<Record<string, unknown>>): string[] {
  const path: string[] = [];
  for (const level of levels) {
    const value = String(row[level] ?? "").trim();
    if (value === "" || value === MISSING_LABEL || value === path[path.length - 1]) continue;
    path.push(value);
  }
  return path.length > 0 ? path : [MISSING_LABEL];
}

export function buildTree(
  levels: readonly string[], measures: readonly string[], rows: readonly Readonly<Record<string, unknown>>[],
): { roots: TreeNode[]; total: number[] } {
  const top: TreeNode = { key: "", label: "", depth: -1, values: measures.map(() => 0), children: [], first: "" };
  const index = new Map<string, TreeNode>();
  for (const row of rows) {
    const values = measures.map((m) => num(row[m]));
    const path = pathOf(levels, row);
    const leaf = path[path.length - 1];
    let parent = top;
    path.forEach((label, depth) => {
      const key = `${parent.key}\u0000${label}`;
      let node = index.get(key);
      if (!node) {
        node = { key, label, depth, values: measures.map(() => 0), children: [], first: leaf };
        index.set(key, node);
        parent.children.push(node);
      }
      if (leaf.localeCompare(node.first, "pt-BR", { numeric: true }) < 0) node.first = leaf;
      node.values = node.values.map((v, i) => v + values[i]);
      parent = node;
    });
    top.values = top.values.map((v, i) => v + values[i]);
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => nodes.sort(byChart).map((n) => ({ ...n, children: sort(n.children) }));
  // Cents: sums of many floats leave dust.
  return { roots: sort(top.children), total: top.values.map((v) => Math.round(v * 100) / 100) };
}

/** The lines open when the page loads: those above `depth`. */
export function initialOpen(roots: readonly TreeNode[], depth: number): Set<string> {
  const open = new Set<string>();
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if (n.depth < depth && n.children.length > 0) open.add(n.key);
      walk(n.children);
    }
  };
  walk(roots);
  return open;
}

/** Every line that has lines under it (to open them all). */
export function allGroups(roots: readonly TreeNode[]): Set<string> {
  return initialOpen(roots, Number.POSITIVE_INFINITY);
}

/**
 * The lines on screen, in order: those under open lines; with a search, those whose text holds it and every
 * line above them (opened), whatever is open.
 */
export function visibleRows(roots: readonly TreeNode[], open: ReadonlySet<string>, search: string): VisibleRow[] {
  const q = search.trim().toLocaleLowerCase("pt-BR");
  const out: VisibleRow[] = [];
  const hits = (n: TreeNode): boolean => n.label.toLocaleLowerCase("pt-BR").includes(q) || n.children.some(hits);
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if (q && !hits(n)) continue;
      const match = q !== "" && n.label.toLocaleLowerCase("pt-BR").includes(q);
      const isOpen = q ? n.children.some(hits) : open.has(n.key);
      out.push({ node: n, depth: n.depth, open: isOpen, match });
      if (isOpen) walk(n.children);
    }
  };
  walk(roots);
  return out;
}
