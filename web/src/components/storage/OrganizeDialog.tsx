"use client";

import { useEffect, useState } from "react";
import { explorerApi, type OrganizePlan, type OrganizeResult } from "./api";
import { organizeBatches } from "./organize-batches";

interface OrganizeDialogProps {
  org: string;
  /** Folder to organize (its sub-folders too), relative to the organization's folder. */
  folder: string;
  folderName: string;
  onDone: (result: OrganizeResult) => void;
  onCancel: () => void;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * "Organizar pasta": recognized fiscal files (SPED, NF-e) found loose in the folder go to the standard
 * <espaço>/fiscal/<molde>/<CNPJ>/<período>/. A preview lists every move first; nothing moves until confirmed.
 */
export function OrganizeDialog({ org, folder, folderName, onDone, onCancel }: OrganizeDialogProps) {
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    explorerApi.organizePreview(org, folder).then(
      (p) => {
        if (!live) return;
        setPlan(p);
        setChosen(new Set(p.moves.filter((m) => m.suggested).map((m) => m.path)));
      },
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [org, folder]);

  const apply = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    const batches = organizeBatches(plan.moves, chosen);
    let result: OrganizeResult = { done: [], failed: [] };
    try {
      for (const [i, paths] of batches.entries()) {
        setProgress(batches.length > 1 ? `${i + 1}/${batches.length}` : null);
        const part = await explorerApi.organizeApply(org, folder, paths);
        result = { done: [...result.done, ...part.done], failed: [...result.failed, ...part.failed] };
      }
      onDone(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível organizar.";
      // Earlier batches already moved: report them too, so the explorer refreshes.
      if (result.done.length > 0) onDone({ ...result, failed: [{ path: "", error: `${message} (os lotes seguintes não foram enviados)` }, ...result.failed] });
      else setError(message);
      setBusy(false);
      setProgress(null);
    }
  };

  const toggle = (path: string): void =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div role="dialog" aria-label="Organizar pasta" onKeyDown={(e) => e.key === "Escape" && onCancel()} className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      {/* Height capped by the overlay: the list scrolls and the buttons stay in view. */}
      <div className="flex max-h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
        <header className="shrink-0 border-b border-line px-5 py-4">
          <h3 className="font-semibold">Organizar “{folderName}”</h3>
          <p className="mt-0.5 text-xs text-muted">
            Arquivos fiscais reconhecidos (SPED e NF-e) vão para a pasta padrão do espaço:
            <code className="ml-1 font-mono">fiscal/&lt;molde&gt;/&lt;CNPJ&gt;/&lt;período&gt;</code>. Subpastas também são verificadas.
            Os demais arquivos ficam onde estão.
          </p>
        </header>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 text-sm">
          {error && <p className="text-danger">{error}</p>}
          {!plan && !error && (
            <p className="flex items-center gap-2 text-muted">
              <span aria-hidden className="dbi-spin inline-block size-3.5 rounded-full border-2 border-current border-t-transparent" />
              Lendo os arquivos…
            </p>
          )}
          {plan && (
            <>
              <p className="mb-2 text-xs text-muted">
                {plan.moves.length} para organizar · {plan.inPlace} já no lugar · {plan.unrecognized.length} não reconhecido(s) · {plan.others} outro(s) arquivo(s)
                {plan.truncated ? " · pasta grande: só os primeiros 5.000 arquivos foram vistos" : ""}
              </p>
              {plan.moves.length === 0 ? (
                <p className="py-6 text-center text-muted">Nada a organizar: os arquivos fiscais já estão nas pastas padrão.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {plan.moves.map((m) => (
                    <li key={m.path} className="flex items-start gap-3 px-3 py-2">
                      <input type="checkbox" checked={chosen.has(m.path)} onChange={() => toggle(m.path)} aria-label={`Organizar ${fileName(m.path)}`} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={m.path}>{fileName(m.path)}</p>
                        <p className="truncate text-xs text-muted">{m.layout}</p>
                        <p className="truncate font-mono text-[11px] text-muted" title={m.to}>→ {m.to}</p>
                        {m.note && <p className="text-[11px] text-accent">⚠ {m.note}</p>}
                      </div>
                      {m.replaces && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent" title="Já existe o mesmo documento na pasta: ele será substituído por este">substitui o existente</span>}
                    </li>
                  ))}
                </ul>
              )}
              {plan.unrecognized.length > 0 && (
                <details className="mt-3 text-xs text-muted">
                  <summary className="cursor-pointer">{plan.unrecognized.length} arquivo(s) .txt/.xml não reconhecido(s) — ficam onde estão</summary>
                  <ul className="mt-1 list-disc pl-5">{plan.unrecognized.slice(0, 50).map((p) => <li key={p} className="truncate">{p}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="btn btn-ghost" autoFocus>Cancelar</button>
          <button type="button" onClick={() => void apply()} disabled={busy || chosen.size === 0} className="btn btn-primary disabled:opacity-50">
            {busy ? `Organizando…${progress ? ` (lote ${progress})` : ""}` : `Organizar ${chosen.size} arquivo${chosen.size === 1 ? "" : "s"}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
