"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Rows drawn at first and added each time the reader reaches the end of the list. */
export const PAGE_SIZE = 25;

export interface ScrollColumn {
  label: string;
  headClass: string;
  cellClass: string;
  /** Show the full value on hover (cells that truncate). */
  hint?: boolean;
  /** Extra class of a cell by its text (e.g. the colour of "Ruptura" in a classification). */
  tones?: Readonly<Record<string, string>>;
}

/** Raw value of a cell, used to sort (numbers sort as numbers, not as their formatted text). */
export type SortValue = string | number | null;

export interface TableSort {
  column: number;
  dir: "asc" | "desc";
}

interface ScrollTableProps {
  columns: readonly ScrollColumn[];
  /** Cells already formatted, one array per row, in column order. */
  rows: readonly (readonly string[])[];
  /** Raw values behind the cells, same shape as `rows`; without it, the cell text is sorted. */
  sortValues?: readonly (readonly SortValue[])[];
  /** Smaller type and tighter rows (raw listings). */
  dense?: boolean;
  /** Shown under the last row once every row is on screen (e.g. "use the filters to reach the rest"). */
  note?: string;
  /** Indexes (in `rows`) of the highlighted rows; the others fade while there is any. */
  selectedRows?: ReadonlySet<number>;
  /** Makes the rows clickable. `additive` = Ctrl/Cmd/Shift held. */
  onRowClick?: (index: number, additive: boolean) => void;
  /** The order the rows already come in, when it is by one column: its header shows the arrow from the start. */
  initialSort?: TableSort;
  /** A last line that stays in view under the rows and does not sort with them (the totals), in column order. */
  footer?: readonly string[];
}

export function nextVisible(current: number, total: number): number {
  return Math.min(current + PAGE_SIZE, total);
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Row indexes in display order: the original order without a sort; empty cells always go last. */
export function sortOrder(values: readonly (readonly SortValue[])[], sort: TableSort | null): number[] {
  const order = values.map((_, i) => i);
  if (!sort) return order;
  const empty = (v: SortValue | undefined): boolean => v === null || v === undefined || v === "";
  const sign = sort.dir === "asc" ? 1 : -1;
  return order.sort((x, y) => {
    const a = values[x][sort.column];
    const b = values[y][sort.column];
    if (empty(a) || empty(b)) return empty(a) === empty(b) ? x - y : empty(a) ? 1 : -1;
    return sign * compare(a, b) || x - y;
  });
}

/**
 * The sort after a click on a header: numbers start from the largest, text from A; a second click
 * reverses it and a third goes back to the original order.
 */
export function nextSort(current: TableSort | null, column: number, numeric: boolean): TableSort | null {
  const first = numeric ? "desc" : "asc";
  if (!current || current.column !== column) return { column, dir: first };
  if (current.dir === first) return { column, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

interface Shown {
  rows: ScrollTableProps["rows"];
  count: number;
}

/**
 * Table of fixed maximum height that scrolls inside its card and draws its rows 25 at a time, so a long
 * table neither stretches the page nor puts hundreds of rows in the DOM before anyone looks at them.
 * A click on a column header sorts by it.
 */
export function ScrollTable({ columns, rows, sortValues, dense = false, note, selectedRows, onRowClick, initialSort, footer }: ScrollTableProps) {
  const [shown, setShown] = useState<Shown>({ rows, count: PAGE_SIZE });
  // New data (a filter changed): start again from the top.
  if (shown.rows !== rows) setShown({ rows, count: PAGE_SIZE });
  const count = Math.min(shown.rows === rows ? shown.count : PAGE_SIZE, rows.length);

  // Kept across data changes: a filter does not undo the chosen order.
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  const values = sortValues ?? rows;
  const order = useMemo(() => sortOrder(values, sort && sort.column < columns.length ? sort : null), [values, sort, columns.length]);

  const box = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = count < rows.length;

  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [rows, sort]);

  useEffect(() => {
    const target = sentinel.current;
    if (!hasMore || !target) return;
    if (typeof IntersectionObserver === "undefined") {
      // No way to notice the end of the list: draw everything, as before.
      setShown((s) => ({ rows: s.rows, count: s.rows.length }));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown((s) => ({ rows: s.rows, count: nextVisible(s.count, s.rows.length) }));
        }
      },
      { root: box.current, rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // `count` re-arms the observer: the sentinel may still be in view after a page is added.
  }, [hasMore, count]);

  const sortBy = (column: number): void => {
    const numeric = values.some((r) => typeof r[column] === "number");
    setSort((current) => nextSort(current, column, numeric));
  };

  const pad = dense ? "px-1.5 py-1.5" : "px-1 py-2";
  const total = rows.length.toLocaleString("pt-BR");
  const anySelected = (selectedRows?.size ?? 0) > 0;
  return (
    <div ref={box} tabIndex={0} role="region" aria-label="Tabela com rolagem" className="-mx-1 max-h-[28rem] overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand">
      <table className={`w-full ${dense ? "text-xs" : "text-sm"}`}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-line text-left text-xs text-muted">
            {columns.map((c, j) => {
              const dir = sort?.column === j ? sort.dir : null;
              return (
                <th
                  key={j}
                  onClick={() => sortBy(j)}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  title="Clique para classificar por esta coluna"
                  className={`group cursor-pointer select-none whitespace-nowrap ${dense ? "px-1.5" : "px-1"} py-2 font-medium hover:text-text ${dir ? "text-text" : ""} ${c.headClass}`}
                >
                  {c.label}
                  {/* The arrow of the column in use; on the others, a faint one shows on hover that they sort too. */}
                  {dir
                    ? <span aria-hidden className="ml-1 text-brand-2">{dir === "asc" ? "▲" : "▼"}</span>
                    : <span aria-hidden className="ml-1 opacity-0 group-hover:opacity-40">▼</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {order.slice(0, count).map((i) => {
            const r = rows[i];
            const selected = selectedRows?.has(i) ?? false;
            return (
              <tr
                key={i}
                onClick={onRowClick ? (e) => onRowClick(i, e.ctrlKey || e.metaKey || e.shiftKey) : undefined}
                aria-selected={onRowClick ? selected : undefined}
                className={`border-b border-line/50 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-text/5" : ""} ${
                  selected ? "bg-brand/15" : anySelected ? "opacity-45" : ""
                }`}
              >
                {columns.map((c, j) => (
                  <td key={j} className={`${pad} ${c.cellClass} ${c.tones?.[r[j]] ?? ""}`} title={c.hint ? r[j] : undefined}>{r[j]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && (
          <tfoot className="sticky bottom-0 z-10 bg-card">
            <tr className="border-t border-line font-semibold">
              {columns.map((c, j) => (
                <td key={j} className={`${pad} ${c.cellClass}`} title={c.hint ? footer[j] : undefined}>{footer[j] ?? ""}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {hasMore && (
        <div ref={sentinel} className="px-1.5 py-2 text-[11px] text-muted">
          {count.toLocaleString("pt-BR")} de {total} linhas
        </div>
      )}
      {!hasMore && note && <p className="px-1.5 py-2 text-[11px] text-muted">{note}</p>}
    </div>
  );
}
