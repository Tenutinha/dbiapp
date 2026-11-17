"use client";

import { useMemo } from "react";
import { isPicked } from "@/lib/query/cross";
import { cellKey, matrixGrid, monthLabel, rowLabel, shade } from "./matrix-grid";
import { isAdditive, useCrossFilter } from "./useCrossFilter";

interface MatrixMapProps {
  /** Id of the visual in the template: names its cross-filter selection. */
  visualId: string;
  rowField: string;
  columnField: string;
  rowTitle: string;
  /** What the number of a cell counts (e.g. "linhas"). */
  measureLabel: string;
  points: readonly { row: string; column: string; value: number | null; text: string }[];
}

/**
 * A map of what the data has: a line per value of one field (the companies), a column per value of another
 * (the months), a square where there is data — stronger where there is more. A click on a square shows the
 * rest of the page for that pair alone (one file); on a line's name or a column's head, for that line or
 * column. Ctrl or Shift adds to what is picked. Scrolls both ways inside a fixed height.
 */
export function MatrixMap({ visualId, rowField, columnField, rowTitle, measureLabel, points }: MatrixMapProps) {
  const { own, pick, pending } = useCrossFilter(visualId, [rowField, columnField]);
  const grid = useMemo(() => matrixGrid(points), [points]);
  const anyPicked = (own[rowField]?.length ?? 0) + (own[columnField]?.length ?? 0) > 0;
  const years = new Set(grid.columns.map((c) => c.slice(0, 4)));
  const head = "cursor-pointer hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand-2";

  if (grid.rows.length === 0) return <p className="py-6 text-sm text-muted">Sem dados para os filtros atuais.</p>;
  return (
    <div className={`transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="max-h-[26rem] overflow-auto pb-1">
        <table className="border-separate border-spacing-[2px] text-[11px]" aria-label={`${rowTitle} por mês`}>
          <thead className="sticky top-0 z-[2] bg-card">
            <tr>
              <th className="sticky left-0 z-[1] bg-card pr-2 text-left font-normal text-muted">{rowTitle}</th>
              {grid.columns.map((c) => {
                const picked = own[columnField]?.includes(c) ?? false;
                const tick = !grid.monthly || c.endsWith("-01") || c === grid.columns[0];
                return (
                  <th key={c} scope="col" className="w-4 min-w-4 p-0 text-center font-normal text-muted">
                    <button
                      type="button"
                      className={`block h-4 w-4 ${head} ${picked ? "font-semibold text-brand-2" : ""}`}
                      title={`${monthLabel(c)}: clique para ver só esta coluna`}
                      aria-label={`${monthLabel(c)}: ver só esta coluna`}
                      aria-pressed={picked}
                      onClick={(e) => pick([{ fieldId: columnField, value: c }], isAdditive(e))}
                    >
                      {tick ? <span className="block w-4 overflow-visible whitespace-nowrap">{grid.monthly ? (years.size > 1 ? c.slice(2, 4) : c.slice(5, 7)) : c}</span> : <span aria-hidden>·</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const rowPicked = own[rowField]?.includes(row) ?? false;
              return (
                <tr key={row}>
                  <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-card pr-2 text-left font-mono font-normal">
                    <button
                      type="button"
                      className={`${head} ${rowPicked ? "font-semibold text-brand-2" : ""}`}
                      title="Clique para ver só esta linha"
                      aria-pressed={rowPicked}
                      onClick={(e) => pick([{ fieldId: rowField, value: row }], isAdditive(e))}
                    >
                      {rowLabel(row)}
                    </button>
                  </th>
                  {grid.columns.map((c) => {
                    const cell = grid.cells[cellKey(row, c)];
                    if (!cell) return <td key={c} className="h-4 w-4 rounded-[3px] border border-dashed border-line" title={`${monthLabel(c)}: sem dados`} />;
                    const picked = isPicked(own, { [rowField]: row, [columnField]: c });
                    const title = `${rowLabel(row)} · ${monthLabel(c)}: ${cell.text} ${measureLabel}`;
                    return (
                      <td key={c} className="h-4 w-4 p-0">
                        <button
                          type="button"
                          className={`block h-4 w-4 cursor-pointer rounded-[3px] bg-brand-2 hover:outline hover:outline-1 hover:outline-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                            picked ? "outline outline-2 outline-offset-1 outline-text" : ""
                          }`}
                          style={{ opacity: anyPicked && !picked ? 0.2 : shade(cell.value, grid.max) }}
                          title={`${title}. Clique para ver só este.`}
                          aria-label={title}
                          aria-pressed={picked}
                          onClick={(e) => pick([{ fieldId: rowField, value: row }, { fieldId: columnField, value: c }], isAdditive(e))}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {grid.rows.length.toLocaleString("pt-BR")} linha(s) × {grid.columns.length.toLocaleString("pt-BR")} coluna(s)
        {grid.monthly && grid.columns.length > 0 ? `, de ${monthLabel(grid.columns[0])} a ${monthLabel(grid.columns[grid.columns.length - 1])}${years.size > 1 ? "; o número marca janeiro de cada ano" : ""}` : ""}.
        {" "}Quadrado mais forte: mais {measureLabel}. Tracejado: sem dados.
      </p>
    </div>
  );
}
