"use client";

import type { FileMap } from "@/lib/fiscal/panel";
import { formatBytes } from "@/lib/format";
import { count, periodLabel, STATE_LABEL, taxIdLabel } from "./labels";

interface FileMapGridProps {
  map: FileMap;
  /** Who manages the data: each cell with files is a button that picks it ("<cnpj>|<aaaa-mm>"). */
  onSelect?: (cell: string) => void;
  selected?: string | null;
  /** The cell whose file is being read now (it blinks). */
  busy?: string | null;
}

/**
 * The map of one model: a row per company, a column per month, each cell colored by the state of its
 * files (the worst one). Empty cells are months without a file. Scrolls both ways inside a fixed height.
 */
export function FileMapGrid({ map, onSelect, selected = null, busy = null }: FileMapGridProps) {
  if (map.companies.length === 0) return <p className="text-sm text-muted">Nenhum arquivo guardado nas pastas de empresa e mês.</p>;
  const years = new Set(map.periods.map((p) => p.slice(0, 4)));
  return (
    <div className="max-h-[26rem] overflow-auto pb-1">
      <table className="border-separate border-spacing-[2px] text-[11px]" aria-label="Arquivos por empresa e mês">
        <thead className="sticky top-0 z-[2] bg-card">
          <tr>
            <th className="sticky left-0 z-[1] bg-card pr-2 text-left font-normal text-muted">Empresa</th>
            {map.periods.map((p) => (
              <th key={p} scope="col" className="w-4 min-w-4 p-0 text-center font-normal text-muted" title={periodLabel(p)}>
                {p.endsWith("-01") || p === map.periods[0] ? <span className="block w-4 overflow-visible whitespace-nowrap">{years.size > 1 ? p.slice(2, 4) : p.slice(5, 7)}</span> : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {map.companies.map((cnpj) => (
            <tr key={cnpj}>
              <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-card pr-2 text-left font-mono font-normal">{taxIdLabel(cnpj)}</th>
              {map.periods.map((p) => {
                const id = `${cnpj}|${p}`;
                const cell = map.cells[id];
                if (!cell) return <td key={p} className="h-4 w-4 rounded-[3px] border border-dashed border-line" title={`${periodLabel(p)}: sem arquivo`} />;
                const state = STATE_LABEL[cell.state];
                const title = `${taxIdLabel(cnpj)} · ${periodLabel(p)}: ${count(cell.files)} arquivo(s), ${formatBytes(cell.sizeBytes)} — ${state.label.toLowerCase()}`;
                const ring = selected === id ? " outline outline-2 outline-offset-1 outline-text" : "";
                const blink = busy === id ? " animate-pulse" : "";
                return (
                  <td key={p} className="h-4 w-4 p-0">
                    {onSelect ? (
                      <button
                        type="button"
                        className={`block h-4 w-4 cursor-pointer rounded-[3px] hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2${ring}${blink}`}
                        style={{ background: state.color }}
                        title={`${title}. Clique para ver os arquivos e ler.`}
                        aria-label={title}
                        aria-pressed={selected === id}
                        onClick={() => onSelect(id)}
                      />
                    ) : (
                      <span className={`block h-4 w-4 rounded-[3px]${blink}`} style={{ background: state.color }} title={title} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {years.size > 1 && <p className="sticky left-0 mt-1 text-[11px] text-muted">Colunas: meses de {periodLabel(map.periods[0])} a {periodLabel(map.periods[map.periods.length - 1])}; o número marca janeiro de cada ano.</p>}
    </div>
  );
}
