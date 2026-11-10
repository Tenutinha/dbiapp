"use client";

import { useEffect, useRef, useState } from "react";

/** Rows drawn at first and added each time the reader reaches the end of the list. */
export const PAGE_SIZE = 25;

export interface ScrollColumn {
  label: string;
  headClass: string;
  cellClass: string;
  /** Show the full value on hover (cells that truncate). */
  hint?: boolean;
}

interface ScrollTableProps {
  columns: readonly ScrollColumn[];
  /** Cells already formatted, one array per row, in column order. */
  rows: readonly (readonly string[])[];
  /** Smaller type and tighter rows (raw listings). */
  dense?: boolean;
  /** Shown under the last row once every row is on screen (e.g. "use the filters to reach the rest"). */
  note?: string;
}

export function nextVisible(current: number, total: number): number {
  return Math.min(current + PAGE_SIZE, total);
}

interface Shown {
  rows: ScrollTableProps["rows"];
  count: number;
}

/**
 * Table of fixed maximum height that scrolls inside its card and draws its rows 25 at a time, so a long
 * table neither stretches the page nor puts hundreds of rows in the DOM before anyone looks at them.
 */
export function ScrollTable({ columns, rows, dense = false, note }: ScrollTableProps) {
  const [shown, setShown] = useState<Shown>({ rows, count: PAGE_SIZE });
  // New data (a filter changed): start again from the top.
  if (shown.rows !== rows) setShown({ rows, count: PAGE_SIZE });
  const count = Math.min(shown.rows === rows ? shown.count : PAGE_SIZE, rows.length);

  const box = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = count < rows.length;

  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [rows]);

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

  const pad = dense ? "px-1.5 py-1.5" : "px-1 py-2";
  const total = rows.length.toLocaleString("pt-BR");
  return (
    <div ref={box} tabIndex={0} role="region" aria-label="Tabela com rolagem" className="-mx-1 max-h-[28rem] overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand">
      <table className={`w-full ${dense ? "text-xs" : "text-sm"}`}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-line text-left text-xs text-muted">
            {columns.map((c, j) => (
              <th key={j} className={`whitespace-nowrap ${dense ? "px-1.5" : "px-1"} py-2 font-medium ${c.headClass}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, count).map((r, i) => (
            <tr key={i} className="border-b border-line/50 last:border-0">
              {columns.map((c, j) => (
                <td key={j} className={`${pad} ${c.cellClass}`} title={c.hint ? r[j] : undefined}>{r[j]}</td>
              ))}
            </tr>
          ))}
        </tbody>
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
