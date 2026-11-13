"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PanelFile } from "@/lib/services/fiscal-panel";
import { count } from "./labels";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ReadProgress {
  done: number;
  total: number;
  failed: number;
  current: string;
  /** "<cnpj>|<aaaa-mm>" of the file on its way: its cell of the map blinks. */
  cell: string;
}

export interface ReadOutcome {
  ok: boolean;
  text: string;
}

interface FileReaderState {
  /** Reads these files one request at a time; resolves when done or stopped. */
  read: (files: readonly PanelFile[]) => Promise<void>;
  stop: () => void;
  reading: boolean;
  progress: ReadProgress | null;
  /** How the last read ended (cleared when another one starts). */
  outcome: ReadOutcome | null;
  /** Keys whose read failed in this page (shown before the panel is refreshed). */
  failedKeys: ReadonlySet<string>;
}

const Context = createContext<FileReaderState | null>(null);

export function useFileReader(): FileReaderState {
  const state = useContext(Context);
  if (!state) throw new Error("useFileReader outside FileReaderProvider");
  return state;
}

async function readOne(dashboardId: string, key: string): Promise<Envelope<{ ok: boolean }>> {
  try {
    const res = await fetch(`/api/instances/${dashboardId}/fiscal/ler`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
    });
    return (await res.json()) as Envelope<{ ok: boolean }>;
  } catch {
    return { success: false, error: "Sem conexão com o servidor." };
  }
}

/**
 * One reader per fiscal dashboard, shared by the map (read one month) and the buttons (read everything
 * missing): one file per request, "37 de 103", stoppable; what was read stays read if the page closes.
 */
export function FileReaderProvider({ dashboardId, children }: { dashboardId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ReadProgress | null>(null);
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null);
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(new Set());
  const stopped = useRef(false);
  const running = useRef(false);

  const read = useCallback(async (files: readonly PanelFile[]): Promise<void> => {
    if (running.current || files.length === 0) return;
    running.current = true;
    stopped.current = false;
    setOutcome(null);
    let failed = 0;
    let done = 0;
    let refused: string | null = null;
    for (const file of files) {
      if (stopped.current) break;
      setProgress({ done, total: files.length, failed, current: file.path, cell: `${file.cnpj}|${file.periodo}` });
      const res = await readOne(dashboardId, file.key);
      if (!res.success) {
        failed += 1;
        setFailedKeys((prev) => new Set(prev).add(file.key));
        // The server refused the request itself (not the file): stop instead of failing every file the same way.
        if (!res.data && res.error && !/arquivo/i.test(res.error)) {
          refused = res.error;
          break;
        }
      }
      done += 1;
    }
    setProgress(null);
    running.current = false;
    setOutcome(refused ? { ok: false, text: refused } : {
      ok: failed === 0,
      text: `${count(done)} de ${count(files.length)} arquivo(s) lido(s)${failed > 0 ? `, ${count(failed)} com erro` : ""}${stopped.current ? " (interrompido)" : ""}.`
        + (done === files.length ? " Depois, monte as tabelas." : " O que já foi lido fica guardado: continue quando quiser."),
    });
    router.refresh();
  }, [dashboardId, router]);

  const value = useMemo<FileReaderState>(() => ({
    read, stop: () => { stopped.current = true; }, reading: progress !== null, progress, outcome, failedKeys,
  }), [read, progress, outcome, failedKeys]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The progress of the read under way: "Lendo 3 de 12", a bar, the file on its way and a way to stop. */
export function ReadStatus() {
  const { progress, outcome, stop } = useFileReader();
  if (!progress && !outcome) return null;
  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      {progress && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              Lendo {count(progress.done + 1)} de {count(progress.total)}
              {progress.failed > 0 ? ` · ${count(progress.failed)} com erro` : ""}
            </p>
            <button type="button" className="text-sm text-muted hover:underline" onClick={stop}>Parar depois deste</button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-brand-2 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="truncate font-mono text-xs text-muted" title={progress.current}>{progress.current}</p>
        </>
      )}
      {!progress && outcome && (
        <p className={`text-sm ${outcome.ok ? "text-ok" : "text-danger"}`}>{outcome.ok ? "✓" : "✕"} {outcome.text}</p>
      )}
    </div>
  );
}
