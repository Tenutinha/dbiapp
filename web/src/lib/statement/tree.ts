/**
 * Builds a financial statement (e.g. an income statement) from the rows of its query: the lines in their
 * order, each group line opened down its levels, the subtotals, a column per period and the share of each
 * value in the base line. Pure, so it is unit-tested directly.
 */
import type { StatementIcon, StatementVisual } from "../templates/schema";

/** How the columns are cut: the periods as they come (e.g. months) or added up by year. */
export type StatementPeriod = "column" | "year";

export interface StatementNode {
  /** Unique within the statement: the line id, then the opening path. */
  key: string;
  label: string;
  /** 0 for the statement's own lines, 1 for their first level, … */
  depth: number;
  kind: "group" | "total" | "detail";
  icon?: StatementIcon;
  /** One value per column (the last one is the total of the period when there is more than one column). */
  values: number[];
  /** Share of each value in the base line's value of the same column (null when there is no base or it is 0). */
  shares: (number | null)[];
  children: StatementNode[];
}

export interface Statement {
  /** Column headings: the periods, and "Total" at the end when there is more than one. */
  columns: string[];
  lines: StatementNode[];
}

type Row = Readonly<Record<string, unknown>>;

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

interface Draft {
  key: string;
  label: string;
  depth: number;
  values: number[];
  children: Map<string, Draft>;
}

const draft = (key: string, label: string, depth: number, width: number): Draft => ({
  key, label, depth, values: new Array<number>(width).fill(0), children: new Map(),
});

/** The opening path of a row: its level values, leaving out missing ones and a value equal to the one above. */
export function openingPath(row: Row, levels: readonly string[], missing: string): string[] {
  const path: string[] = [];
  for (const level of levels) {
    const value = row[level];
    const text = value === null || value === undefined ? "" : String(value).trim();
    if (text === "" || text === missing || text === path.at(-1)) continue;
    path.push(text);
  }
  return path;
}

const asNumber = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const periodOf = (value: unknown, period: StatementPeriod): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return period === "year" ? text.slice(0, 4) : text;
};

export function buildStatement(
  visual: Pick<StatementVisual, "lines" | "levels" | "column" | "measure" | "base">,
  rows: readonly Row[],
  options: { lineColumn: string; missing: string; period?: StatementPeriod },
): Statement {
  const period = options.period ?? "column";
  const periods = [...new Set(rows.map((r) => periodOf(r[visual.column], period)))].filter(Boolean).sort(collator.compare);
  const withTotal = periods.length > 1;
  const width = periods.length + (withTotal ? 1 : 0);
  const at = new Map(periods.map((p, i) => [p, i]));

  const groups = new Map<string, Draft>();
  const seen = new Set<string>();
  for (const line of visual.lines) if (line.where !== undefined) groups.set(line.id, draft(line.id, line.label, 0, width));

  for (const row of rows) {
    const root = groups.get(String(row[options.lineColumn] ?? ""));
    const column = at.get(periodOf(row[visual.column], period));
    if (!root || column === undefined) continue;
    seen.add(root.key);
    const value = asNumber(row[visual.measure]);
    let node = root;
    node.values[column] += value;
    for (const label of openingPath(row, visual.levels, options.missing)) {
      let child = node.children.get(label);
      if (!child) {
        child = draft(`${node.key}\u0001${label}`, label, node.depth + 1, width);
        node.children.set(label, child);
      }
      child.values[column] += value;
      node = child;
    }
  }

  const zeros = (): number[] => new Array<number>(width).fill(0);
  const withPeriodTotal = (values: readonly number[]): number[] =>
    withTotal ? [...values.slice(0, -1), values.slice(0, -1).reduce((a, b) => a + b, 0)] : [...values];
  // Periods only (the total column is worked out at the end): subtotals add up earlier lines' periods.
  const totals = new Map<string, number[]>();
  for (const line of visual.lines) {
    const values = line.sum
      ? line.sum.reduce((acc, id) => acc.map((v, i) => v + (totals.get(id)?.[i] ?? 0)), zeros())
      : [...(groups.get(line.id)?.values ?? zeros())];
    totals.set(line.id, withPeriodTotal(values));
  }
  const base = visual.base === undefined ? undefined : totals.get(visual.base);
  const shares = (values: readonly number[]): (number | null)[] =>
    values.map((v, i) => (base && base[i] !== 0 ? v / Math.abs(base[i]) : null));

  const finish = (d: Draft, kind: StatementNode["kind"]): StatementNode => {
    const values = withPeriodTotal(d.values);
    return {
      key: d.key, label: d.label, depth: d.depth, kind, values, shares: shares(values),
      // A group or account that added nothing in any period says nothing: it is left out.
      children: [...d.children.values()]
        .filter((c) => c.values.some((v) => Math.abs(v) >= 0.005))
        .sort((a, b) => collator.compare(a.label, b.label))
        .map((c) => finish(c, "detail")),
    };
  };

  const lines = visual.lines
    .filter((line) => !(line.optional && line.where !== undefined && !seen.has(line.id)))
    .map((line): StatementNode => {
      const icon = line.icon === undefined ? {} : { icon: line.icon };
      if (line.where !== undefined) return { ...finish(groups.get(line.id) ?? draft(line.id, line.label, 0, width), "group"), ...icon };
      const values = totals.get(line.id) ?? [];
      return { key: line.id, label: line.label, depth: 0, kind: "total", values, shares: shares(values), children: [], ...icon };
    });
  return { columns: withTotal ? [...periods, "Total"] : periods, lines };
}

/** Keys of every node that opens (has children), for "open all". */
export function openableKeys(nodes: readonly StatementNode[]): string[] {
  return nodes.flatMap((n) => (n.children.length > 0 ? [n.key, ...openableKeys(n.children)] : []));
}

/** The nodes shown, in order, given which ones are open. */
export function visibleNodes(nodes: readonly StatementNode[], open: ReadonlySet<string>): StatementNode[] {
  return nodes.flatMap((n) => [n, ...(open.has(n.key) ? visibleNodes(n.children, open) : [])]);
}
