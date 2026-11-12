"use client";

import { useRef, useState } from "react";
import { explorerApi, type OrganizeResult, type OrganizeStep } from "./api";

interface OrganizeDialogProps {
  org: string;
  /** Folder to organize (its sub-folders too), relative to the organization's folder. */
  folder: string;
  folderName: string;
  onDone: (result: OrganizeResult) => void;
  onCancel: () => void;
}

interface Tally {
  scanned: number;
  moved: { path: string; to: string }[];
  kept: { path: string; reason: string }[];
  unrecognized: number;
  others: number;
}

const EMPTY: Tally = { scanned: 0, moved: [], kept: [], unrecognized: 0, others: 0 };
/** Moves listed while it runs (the counts cover all of them). */
const SHOWN = 40;

const add = (t: Tally, s: OrganizeStep): Tally => ({
  scanned: t.scanned + s.scanned,
  moved: [...t.moved, ...s.moved],
  kept: [...t.kept, ...s.kept],
  unrecognized: t.unrecognized + s.unrecognized,
  others: t.others + s.others,
});

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * "Organizar pasta": recognized fiscal files (SPED, NF-e) found loose in the folder go to the standard
 * <espaço>/fiscal/<molde>/<CNPJ>/<período>/, with their own names. It works a batch at a time (the server
 * never lists the whole folder first), so it starts at once on any folder and can be stopped midway.
 */
export function OrganizeDialog({ org, folder, folderName, onDone, onCancel }: OrganizeDialogProps) {
  const [phase, setPhase] = useState<"ask" | "running" | "stopping" | "done">("ask");
  const [tally, setTally] = useState<Tally>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const stop = useRef(false);
  const final = useRef<Tally>(EMPTY);

  const run = async (): Promise<void> => {
    setPhase("running");
    stop.current = false;
    let t = EMPTY;
    let cursor: OrganizeStep["next"] = null;
    try {
      do {
        const step = await explorerApi.organizeStep(org, folder, cursor);
        t = add(t, step);
        setTally(t);
        cursor = step.next;
      } while (cursor && !stop.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível organizar.");
    }
    final.current = t;
    setStopped(stop.current && cursor !== null);
    setPhase("done");
  };

  const close = (): void => {
    const t = final.current;
    if (t.moved.length === 0 && t.kept.length === 0) onCancel();
    else onDone({ done: t.moved, failed: t.kept.map((k) => ({ path: k.path, error: k.reason })) });
  };

  const running = phase === "running" || phase === "stopping";
  const status = phase === "stopping" ? "Parando após este lote…" : running ? "Organizando…" : error ? "Parou com erro." : stopped ? "Parado." : "Pronto.";

  return (
    <div role="dialog" aria-label="Organizar pasta" onKeyDown={(e) => e.key === "Escape" && !running && close()} className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
        <header className="shrink-0 border-b border-line px-5 py-4">
          <h3 className="font-semibold">Organizar “{folderName}”</h3>
          <p className="mt-0.5 text-xs text-muted">
            Arquivos fiscais reconhecidos (SPED e NF-e) vão para a pasta padrão do espaço,
            <code className="mx-1 font-mono">fiscal/&lt;molde&gt;/&lt;CNPJ&gt;/&lt;período&gt;</code>, com o mesmo nome. Subpastas também são
            verificadas; os demais arquivos ficam onde estão. Uma versão nova do mesmo documento substitui a anterior, nunca o contrário.
          </p>
        </header>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-sm">
          {phase === "ask" ? (
            <p className="text-muted">
              Os arquivos são verificados em lotes, sem listar a pasta inteira antes: dá para acompanhar e parar a qualquer momento.
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2">
                {running && <span aria-hidden className="dbi-spin inline-block size-3.5 rounded-full border-2 border-current border-t-transparent" />}
                <span>{status}</span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ["Verificados", tally.scanned],
                  ["Organizados", tally.moved.length],
                  ["Mantidos", tally.kept.length],
                  ["Não fiscais", tally.unrecognized + tally.others],
                ] as const).map(([label, n]) => (
                  <div key={label} className="rounded-lg border border-line px-3 py-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
              {error && <p className="mt-3 text-danger">{error}</p>}
              {tally.moved.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-xs">
                  {tally.moved.length > SHOWN && <li className="text-muted">… e mais {tally.moved.length - SHOWN} antes destes.</li>}
                  {tally.moved.slice(-SHOWN).map((m) => (
                    <li key={m.path} className="truncate" title={`${m.path} → ${m.to}`}>
                      <span className="font-medium">{fileName(m.path)}</span>
                      <span className="text-muted"> → {m.to}</span>
                    </li>
                  ))}
                </ul>
              )}
              {tally.kept.length > 0 && (
                <details className="mt-3 text-xs text-muted">
                  <summary className="cursor-pointer">{tally.kept.length} arquivo(s) fiscal(is) mantido(s) onde estão</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {tally.kept.slice(0, 50).map((k) => <li key={k.path} className="truncate" title={k.reason}>{k.path}: {k.reason}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          {phase === "ask" && (
            <>
              <button type="button" onClick={onCancel} className="btn btn-ghost" autoFocus>Cancelar</button>
              <button type="button" onClick={() => void run()} className="btn btn-primary">Organizar</button>
            </>
          )}
          {running && (
            <button
              type="button"
              disabled={phase === "stopping"}
              onClick={() => {
                stop.current = true;
                setPhase("stopping");
              }}
              className="btn btn-ghost"
            >
              Parar
            </button>
          )}
          {phase === "done" && <button type="button" onClick={close} className="btn btn-primary" autoFocus>Fechar</button>}
        </footer>
      </div>
    </div>
  );
}
