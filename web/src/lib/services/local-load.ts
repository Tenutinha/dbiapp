/**
 * "Converter nesta máquina": the load of a SPED dashboard started from the screen, on a server that runs
 * on the machine that keeps the original files (never on the hosted app, which cannot see a local folder).
 *
 * The screen names the folder; the server checks it against what the dashboard keeps in the bucket, and
 * starts the same load the terminal runs (scripts/fiscal/carregar-fiscal.ts) as a process of its own, so
 * hours of reading neither hold a request nor share memory with the server. What the load prints goes to a
 * log file the screen follows; one load per dashboard at a time.
 */
import "server-only";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstanceAccess } from "../access";
import { AccessError } from "../auth";
import type { BuildStatus } from "../fiscal/build-status";
import { loadPhase, parseLoadLog, type FolderCheck, type LoadLog, type LocalLoadPhase, type LocalLoadRun } from "../fiscal/local-load";
import { indexLocalOriginals, localCandidates } from "../fiscal/local-originals";
import { UserFacingError } from "./datasets";
import { rawFiles, requireImporter } from "./fiscal";
import { hostedLimits, readBuildStatus, spedFilesOverview } from "./fiscal-parts";

/** Where the runs' records, their logs and the load's own cache live (outside the server's cache). */
const RUNS_DIR = path.join(os.tmpdir(), "dbi-carga-local");
const LOAD_SCRIPT = path.join("scripts", "fiscal", "carregar-fiscal.ts");
/** The load's memory, apart from the server's: the Node heap and DuckDB's cap. */
const LOAD_HEAP_MB = 2048;
const LOAD_DUCKDB_LIMIT = "1GB";
/** Files read at the same time: the server that shows the screen is on the same machine, and memory is short. */
const LOAD_READ_CONCURRENCY = "2";
/** Kinds whose files reach hundreds of MB each: one at a time. */
const ONE_AT_A_TIME: readonly string[] = ["ecd"];
/** The most of a log the screen reads at each look (one line per file: a chain of stores writes a few MB). */
const LOG_MAX_BYTES = 32 * 1024 * 1024;

/** Only a server on the machine itself offers it. */
export const localLoadAvailable = (): boolean => !hostedLimits();

/** The folder the screen suggests (the one the loads of this machine already use). */
export const defaultLocalFolder = (): string => process.env.DBI_FISCAL_LOCAL_ORIGINALS?.trim() ?? "";

function requireLocal(access: InstanceAccess): void {
  if (!localLoadAvailable()) throw new UserFacingError("A conversão nesta máquina só existe no servidor local.");
  // It reads a folder of the machine and starts a process: the platform's administrator only.
  if (!access.user.isPlatformAdmin) throw new AccessError(403, "Só o administrador da plataforma converte arquivos nesta máquina.");
}

async function requireFolder(folder: string): Promise<string> {
  const resolved = path.resolve(folder.trim());
  if (!folder.trim() || !path.isAbsolute(folder.trim())) throw new UserFacingError("Informe o caminho completo da pasta dos arquivos originais.");
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new UserFacingError("Essa pasta não existe nesta máquina.");
  return resolved;
}

/** What the folder has for the dashboard's files, and how much is left to read. */
export async function checkLocalFolder(access: InstanceAccess, folder: string): Promise<FolderCheck> {
  requireLocal(access);
  const importer = requireImporter(access);
  if (importer.mode !== "sped") throw new UserFacingError("A conversão nesta máquina lê arquivos SPED.");
  const resolved = await requireFolder(folder);
  const [index, stored] = await Promise.all([indexLocalOriginals(resolved), rawFiles(access)]);
  // The panel's quick look (one listing): reading every marker of a chain of stores takes minutes.
  const { ready } = await spedFilesOverview(access, stored);
  const toRead = stored.filter((f) => !ready.has(f.key));
  const hasLocal = (file: (typeof stored)[number]): boolean => localCandidates(index, file).length > 0;
  return {
    folder: resolved,
    localFiles: [...index.values()].reduce((sum, paths) => sum + paths.length, 0),
    stored: stored.length,
    storedWithLocal: stored.filter(hasLocal).length,
    toRead: toRead.length,
    toReadFromLocal: toRead.filter(hasLocal).length,
  };
}

const runFile = (instanceId: string): string => path.join(RUNS_DIR, `${instanceId}.json`);

async function readRun(instanceId: string): Promise<LocalLoadRun | null> {
  try {
    const run = JSON.parse(await readFile(runFile(instanceId), "utf8")) as Partial<LocalLoadRun>;
    if (typeof run.pid !== "number" || typeof run.logFile !== "string" || typeof run.startedAt !== "string") return null;
    return run as LocalLoadRun;
  } catch {
    return null; // never run from the screen on this machine
  }
}

/** Whether the process is still there (signal 0 only asks). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function logTail(file: string): Promise<string> {
  try {
    const text = await readFile(file, "utf8");
    // Whole, so the live count adds up every file; beyond the limit, the end (the progress and the publication).
    return text.length > LOG_MAX_BYTES ? text.slice(text.indexOf("\n", text.length - LOG_MAX_BYTES) + 1) : text;
  } catch {
    return "";
  }
}

export interface LocalLoadState {
  /** The last load started from the screen for this dashboard (null: none on this machine). */
  run: { folder: string; startedAt: string; phase: LocalLoadPhase } | null;
  log: LoadLog | null;
  /** What the load itself reports to the panel (reading, the table on its way, done, failed). */
  build: BuildStatus | null;
}

export async function localLoadState(access: InstanceAccess): Promise<LocalLoadState> {
  requireLocal(access);
  const run = await readRun(access.instanceId);
  if (!run) return { run: null, log: null, build: null };
  const log = parseLoadLog(await logTail(run.logFile));
  const phase = loadPhase(alive(run.pid), log);
  // The status file only helps while the load runs: afterwards the log already says how it ended.
  const build = phase === "rodando" ? await readBuildStatus(access).catch(() => null) : null;
  return { run: { folder: run.folder, startedAt: run.startedAt, phase }, log, build };
}

/** Starts the load as a process of its own; refuses while another one runs for this dashboard. */
export async function startLocalLoad(access: InstanceAccess, folder: string): Promise<LocalLoadState> {
  requireLocal(access);
  if (requireImporter(access).mode !== "sped") throw new UserFacingError("A conversão nesta máquina lê arquivos SPED.");
  const resolved = await requireFolder(folder);
  const current = await readRun(access.instanceId);
  if (current && alive(current.pid)) throw new UserFacingError("Já há uma conversão deste dashboard rodando nesta máquina.");

  await mkdir(RUNS_DIR, { recursive: true });
  const logFile = path.join(RUNS_DIR, `${access.instanceId}-${Date.now()}.log`);
  // The load's cache goes apart from the server's: two processes on the same cache step on each other.
  const temp = path.join(RUNS_DIR, "tmp");
  await mkdir(temp, { recursive: true });
  const args = [
    `--max-old-space-size=${LOAD_HEAP_MB}`, "--conditions=react-server", "--import", "tsx", LOAD_SCRIPT,
    "--molde", access.templateId, "--org", access.org.slug,
    ...(access.client ? ["--cliente", access.client.slug] : []),
    // Every file's parts: a load that stopped half way left parts the dashboard never got.
    "--dimensoes-das-partes",
    // One line per file read and per table, for the live count on the screen.
    "--eventos",
    // A file that could not be read now (memory, a hiccup) must not leave its month out of what is published.
    "--exige-todos",
  ];
  const out = openSync(logFile, "a");
  try {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        DBI_FISCAL_LOCAL_ORIGINALS: resolved,
        DBI_DUCKDB_MEMORY_LIMIT: process.env.DBI_DUCKDB_MEMORY_LIMIT ?? LOAD_DUCKDB_LIMIT,
        DBI_FISCAL_READ_CONCURRENCY: ONE_AT_A_TIME.includes(access.templateId) ? "1" : (process.env.DBI_FISCAL_READ_CONCURRENCY ?? LOAD_READ_CONCURRENCY),
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
      },
    });
    if (child.pid === undefined) throw new UserFacingError("Não foi possível iniciar a conversão nesta máquina.");
    child.unref();
    const run: LocalLoadRun = {
      pid: child.pid, instanceId: access.instanceId, templateId: access.templateId, folder: resolved,
      startedAt: new Date().toISOString(), logFile,
    };
    await writeFile(runFile(access.instanceId), JSON.stringify(run), "utf8");
  } finally {
    closeSync(out);
  }
  return localLoadState(access);
}

/** Stops the load that runs for this dashboard (what was read stays; the next load goes on from there). */
export async function stopLocalLoad(access: InstanceAccess): Promise<LocalLoadState> {
  requireLocal(access);
  const run = await readRun(access.instanceId);
  if (run && alive(run.pid)) {
    try {
      process.kill(run.pid);
    } catch (err) {
      console.error("[carga-local] could not stop the load", access.instanceId, err);
      throw new UserFacingError("Não foi possível parar a conversão.");
    }
  }
  return localLoadState(access);
}
