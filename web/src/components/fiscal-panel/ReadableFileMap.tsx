"use client";

import { useState } from "react";
import type { FileMap } from "@/lib/fiscal/panel";
import { formatBytes } from "@/lib/format";
import type { PanelFile } from "@/lib/services/fiscal-panel";
import { ReadStatus, useFileReader } from "./FileReader";
import { FileMapGrid } from "./FileMapGrid";
import { count, periodLabel, STATE_LABEL, taxIdLabel } from "./labels";

interface ReadableFileMapProps {
  map: FileMap;
  /** Files to read (missing or failed), each with its company and month. */
  toRead: PanelFile[];
  /** Too big for the app (loaded by the script). */
  big: PanelFile[];
}

const fileName = (f: PanelFile): string => f.path.slice(f.path.lastIndexOf("/") + 1);

/**
 * The map for who manages the data: a click on a cell shows that month's files under the map, with a
 * button to read them (one request per file, sharing the reader with "Ler N arquivo(s)").
 */
export function ReadableFileMap({ map, toRead, big }: ReadableFileMapProps) {
  const reader = useFileReader();
  const [selected, setSelected] = useState<string | null>(null);
  const cell = selected ? map.cells[selected] : undefined;
  const [cnpj, periodo] = selected ? selected.split("|") : ["", ""];
  const inCell = (f: PanelFile): boolean => f.cnpj === cnpj && f.periodo === periodo;
  const pending = toRead.filter(inCell);
  const tooBig = big.filter(inCell);

  return (
    <div className="flex flex-col gap-2">
      <FileMapGrid
        map={map}
        selected={selected}
        busy={reader.progress?.cell ?? null}
        onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
      />
      <ReadStatus />
      {selected && cell && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-mono">{taxIdLabel(cnpj)}</span> · {periodLabel(periodo)}: {count(cell.files)} arquivo(s), {formatBytes(cell.sizeBytes)}
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STATE_LABEL[cell.state].color }} />
                {STATE_LABEL[cell.state].label}
              </span>
            </p>
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => setSelected(null)}>Fechar</button>
          </div>

          {pending.length > 0 && (
            <>
              <ul className="flex flex-col gap-1 text-xs">
                {pending.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-mono">{fileName(f)}</span>
                    <span className="text-muted">{formatBytes(f.sizeBytes)}</span>
                    {(f.error || reader.failedKeys.has(f.key)) && <span className="text-danger">{f.error ?? "a leitura falhou"}</span>}
                    {pending.length > 1 && (
                      <button type="button" className="font-semibold text-brand-2 hover:underline disabled:opacity-50" disabled={reader.reading} onClick={() => void reader.read([f])}>
                        Ler só este
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-primary w-fit" disabled={reader.reading} onClick={() => void reader.read(pending)}>
                {reader.reading ? "Lendo…" : pending.some((f) => f.error) ? `Ler de novo (${count(pending.length)})` : `Ler ${pending.length > 1 ? `os ${count(pending.length)} arquivos` : "o arquivo"} deste mês`}
              </button>
            </>
          )}
          {pending.length === 0 && tooBig.length > 0 && (
            <p className="text-sm text-accent">
              {tooBig.map(fileName).join(", ")}: grande(s) demais para ler pela tela. Peça à equipe da DBI para carregar pelo script.
            </p>
          )}
          {pending.length === 0 && tooBig.length === 0 && (
            <p className="text-sm text-muted">
              {cell.state === "pronto" ? "Já lido: entra nas tabelas quando você montar." : "Nada para ler neste mês."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
