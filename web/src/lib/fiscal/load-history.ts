/**
 * The history of the loads run on this machine: each one leaves a folder with what it printed (`saida.log`,
 * the same lines the terminal and the live page got) and a summary (`resumo.json`: how long it took, files,
 * errors, tables), so one run can be looked at again and compared with the one before.
 *
 * It lives outside the repository — the lines carry establishments and months of a client — in
 * `<home>/dbi-importacoes/conversoes` (or DBI_FISCAL_HISTORY_DIR).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENT_MARK, parseLoadLog, type StepEvent, type TableEvent } from "./local-load";

/** "interrompida": the process died without saying how it ended (killed, or the machine ran out of memory). */
export type RunPhase = "rodando" | "concluida" | "falhou" | "interrompida";

type Stage = StepEvent["etapa"];

export interface RunMeta {
  titulo: string;
  molde: string;
  org: string;
  cliente: string | null;
  /** The options the load ran with (--reler-tudo, --so-blocos…). */
  opcoes: string[];
}

export interface FailedFile {
  cnpj: string;
  periodo: string;
  error: string;
}

export interface RunSummary extends RunMeta {
  id: string;
  pid: number;
  /** ISO times. */
  inicio: string;
  fim: string | null;
  duracaoMs: number | null;
  fase: RunPhase;
  /** When each step began (ISO), as the load reported it. */
  marcos: Partial<Record<Stage, string>>;
  /** How long each step took, in ms (null: the load did not get there). */
  etapas: Record<Stage, number | null>;
  arquivos: { lidos: number; erros: number; total: number | null };
  /** Lines read from the original files in this run. */
  linhas: number;
  bytes: number;
  /** The final tables, as put together. */
  tabelas: TableEvent[];
  falhas: FailedFile[];
  avisos: string[];
  /** What the load said when it stopped before publishing. */
  erro: string | null;
}

const SUMMARY_FILE = "resumo.json";
const LOG_FILE = "saida.log";
/** Failed files kept in a summary (the log has them all). */
const MAX_FAILURES = 200;
const STAGES: readonly Stage[] = ["quebra", "uniao", "publicacao"];

export function historyDir(): string {
  return process.env.DBI_FISCAL_HISTORY_DIR?.trim() || path.join(os.homedir(), "dbi-importacoes", "conversoes");
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A run's folder name: when it started and what it loaded, safe for a path and a URL. */
export function runId(inicio: Date, meta: Pick<RunMeta, "molde" | "org" | "cliente">): string {
  const when = inicio.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return [when, slug(meta.molde), slug(meta.org), ...(meta.cliente ? [slug(meta.cliente)] : [])].filter(Boolean).join("_");
}

/** The step an output line belongs to, when it is a step's line. */
function stageOf(line: string): Stage | null {
  if (!line.startsWith(EVENT_MARK)) return null;
  return STAGES.find((stage) => line.includes(`"etapa":"${stage}"`)) ?? null;
}

function failedFiles(text: string): FailedFile[] {
  const failed: FailedFile[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`${EVENT_MARK}{"arquivo"`) || !line.includes('"ok":false')) continue;
    try {
      const { arquivo } = JSON.parse(line.slice(EVENT_MARK.length)) as { arquivo: { cnpj: string; periodo: string; error?: string } };
      failed.push({ cnpj: arquivo.cnpj, periodo: arquivo.periodo, error: arquivo.error ?? "erro" });
    } catch {
      // a line cut in the middle: the count of failures still comes from the reading of the log
    }
    if (failed.length >= MAX_FAILURES) break;
  }
  return failed;
}

const between = (from: string | undefined, to: string | undefined | null): number | null =>
  from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;

/** What a run did, read from what it printed. Pure. */
export function summarizeRun(
  head: Pick<RunSummary, "id" | "pid" | "inicio" | "marcos"> & RunMeta,
  text: string,
  end: { fim: string | null; fase: RunPhase; erro: string | null },
): RunSummary {
  const log = parseLoadLog(text);
  const live = log.live;
  const { marcos } = head;
  return {
    ...head,
    fim: end.fim,
    duracaoMs: between(head.inicio, end.fim),
    fase: end.fase,
    etapas: {
      quebra: between(marcos.quebra, marcos.uniao ?? marcos.publicacao ?? end.fim),
      uniao: between(marcos.uniao, marcos.publicacao ?? end.fim),
      publicacao: between(marcos.publicacao, end.fim),
    },
    arquivos: { lidos: live ? live.files - live.failed : 0, erros: live?.failed ?? 0, total: live?.filesTotal ?? null },
    linhas: live?.rows ?? 0,
    bytes: live?.bytes ?? 0,
    tabelas: live?.assembled ?? [],
    falhas: failedFiles(text),
    avisos: log.warnings,
    erro: end.erro,
  };
}

export interface RunRecorder {
  id: string;
  /** One line of the load's output. */
  append(line: string): void;
  /** The load is over: writes the summary. */
  close(ok: boolean, erro?: string): RunSummary | null;
}

/**
 * Starts keeping a run. Never lets the history stop a load: a disk that refuses the writes is reported once
 * (on stderr) and the load goes on without it.
 */
export function openRun(dir: string, meta: RunMeta, now: () => Date = () => new Date()): RunRecorder {
  const started = now();
  const id = runId(started, meta);
  const folder = path.join(dir, id);
  const head = { ...meta, id, pid: process.pid, inicio: started.toISOString(), marcos: {} as Partial<Record<Stage, string>> };
  let broken = false;
  const safely = <T>(what: string, fn: () => T): T | null => {
    if (broken) return null;
    try {
      return fn();
    } catch (err) {
      broken = true;
      process.stderr.write(`histórico: não foi possível ${what} em ${folder} (${err instanceof Error ? err.message : String(err)}); a carga segue sem histórico\n`);
      return null;
    }
  };
  const write = (summary: RunSummary): void => writeFileSync(path.join(folder, SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`);
  safely("criar a pasta", () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, LOG_FILE), "");
    write(summarizeRun(head, "", { fim: null, fase: "rodando", erro: null }));
  });
  return {
    id,
    append(line: string): void {
      safely("gravar a saída", () => appendFileSync(path.join(folder, LOG_FILE), `${line}\n`));
      const stage = stageOf(line);
      if (!stage || head.marcos[stage]) return;
      // The first line of a step dates it; kept at once, so a load that dies still says how far it got.
      head.marcos = { ...head.marcos, [stage]: now().toISOString() };
      safely("gravar o resumo", () => write(summarizeRun(head, "", { fim: null, fase: "rodando", erro: null })));
    },
    close(ok: boolean, erro?: string): RunSummary | null {
      return safely("gravar o resumo", () => {
        const summary = summarizeRun(head, readFileSync(path.join(folder, LOG_FILE), "utf8"), {
          fim: now().toISOString(),
          fase: ok ? "concluida" : "falhou",
          erro: ok ? null : (erro ?? null),
        });
        write(summary);
        return summary;
      });
    },
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and is someone else's.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A run still marked as running whose process is gone: it was killed or died without a word. Its summary is
 * read from what it managed to print, ending when it last wrote, and kept that way.
 */
function settle(dir: string, summary: RunSummary, alive: (pid: number) => boolean): RunSummary {
  if (summary.fase !== "rodando" || alive(summary.pid)) return summary;
  const logFile = path.join(dir, summary.id, LOG_FILE);
  const text = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  const fim = existsSync(logFile) ? statSync(logFile).mtime.toISOString() : summary.inicio;
  const settled = summarizeRun(summary, text, { fim, fase: "interrompida", erro: "o processo terminou sem dizer como (encerrado, ou faltou memória na máquina)" });
  try {
    writeFileSync(path.join(dir, summary.id, SUMMARY_FILE), `${JSON.stringify(settled, null, 2)}\n`);
  } catch {
    // read-only history: the summary is worked out again next time
  }
  return settled;
}

/** The runs kept in a folder, the newest first. */
export function listRuns(dir: string, alive: (pid: number) => boolean = isAlive): RunSummary[] {
  if (!existsSync(dir)) return [];
  const runs: RunSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const summary = JSON.parse(readFileSync(path.join(dir, entry.name, SUMMARY_FILE), "utf8")) as RunSummary;
      // The folder is the run's address: a summary copied from another run does not answer for this one.
      if (summary.id === entry.name && typeof summary.inicio === "string") runs.push(settle(dir, summary, alive));
    } catch {
      // not a run (a folder someone made here), or a summary cut by a crash: left out of the list
    }
  }
  return runs.sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0));
}

/** What a kept run printed (only for an id that `listRuns` returned). */
export function readRunLog(dir: string, id: string): string {
  const file = path.join(dir, id, LOG_FILE);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export interface RunComparison {
  /** The run compared against: the one before, of the same dashboard. */
  anterior: { id: string; inicio: string; fase: RunPhase };
  duracaoMs: number | null;
  arquivos: number;
  linhas: number;
  /** Lines of each final table, now and before (null: the table was not in that run). */
  tabelas: { table: string; rows: number | null; antes: number | null }[];
}

const sameDashboard = (a: RunMeta, b: RunMeta): boolean => a.molde === b.molde && a.org === b.org && a.cliente === b.cliente;

export function compareRuns(run: RunSummary, previous: RunSummary): RunComparison {
  const before = new Map(previous.tabelas.map((t) => [t.table, t.rows]));
  const now = new Map(run.tabelas.map((t) => [t.table, t.rows]));
  const names = [...new Set([...now.keys(), ...before.keys()])];
  return {
    anterior: { id: previous.id, inicio: previous.inicio, fase: previous.fase },
    duracaoMs: run.duracaoMs !== null && previous.duracaoMs !== null ? run.duracaoMs - previous.duracaoMs : null,
    arquivos: run.arquivos.lidos - previous.arquivos.lidos,
    linhas: run.linhas - previous.linhas,
    tabelas: names.map((table) => ({ table, rows: now.get(table) ?? null, antes: before.get(table) ?? null })),
  };
}

export type ComparedRun = RunSummary & { comparacao: RunComparison | null };

/** Each run next to the one before it of the same dashboard (`runs` newest first, as `listRuns` gives them). */
export function withComparison(runs: readonly RunSummary[]): ComparedRun[] {
  return runs.map((run, i) => {
    const previous = runs.slice(i + 1).find((other) => sameDashboard(run, other));
    return { ...run, comparacao: previous ? compareRuns(run, previous) : null };
  });
}
