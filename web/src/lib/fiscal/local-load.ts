/**
 * The load of a fiscal dashboard started from the screen on a machine that keeps the original files
 * (see services/local-load.ts): what the screen shows of it. Pure — the log the load prints is the same the
 * script prints on a terminal (scripts/fiscal/carregar-fiscal.ts), read here into steps and tables.
 */

/** A load started from the screen, as kept on disk while (and after) it runs. */
export interface LocalLoadRun {
  pid: number;
  instanceId: string;
  templateId: string;
  /** Folder with the original files on this machine. */
  folder: string;
  /** ISO time. */
  startedAt: string;
  logFile: string;
}

export interface LoadedTable {
  table: string;
  ok: boolean;
  /** "1.125.353 linhas, 19.4 MB", or the error. */
  detail: string;
}

export interface LoadLog {
  /** Files read so far, when the load printed it. */
  read: { done: number; total: number; minutes: number } | null;
  /** "arquivos no dashboard: …" (the reading is over and the tables were put together). */
  summary: string | null;
  tables: LoadedTable[];
  /** Files the reader refused, and warnings of the publication. */
  warnings: string[];
  published: boolean;
  /** The last lines, for who wants to see what the load is saying. */
  tail: string[];
}

const TAIL_LINES = 12;
const MAX_LINE = 300;

/** Reads the load's output into what the screen shows. */
export function parseLoadLog(text: string): LoadLog {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const log: LoadLog = { read: null, summary: null, tables: [], warnings: [], published: false, tail: [] };
  for (const line of lines) {
    const read = /^\s*lidos (\d+) de (\d+) \(([\d.]+) min\)/.exec(line);
    if (read) {
      log.read = { done: Number(read[1]), total: Number(read[2]), minutes: Number(read[3]) };
      continue;
    }
    if (line.startsWith("arquivos no dashboard:")) log.summary = line;
    else if (line.startsWith("publicado:")) log.published = true;
    else if (/^\s+(pulado|aviso:)/.test(line)) log.warnings.push(line.trim().slice(0, MAX_LINE));
    else {
      const table = /^\s+([a-z_][a-z0-9_]*): (.+)$/.exec(line);
      if (table && log.summary) log.tables.push({ table: table[1], ok: !table[2].startsWith("ERRO"), detail: table[2].slice(0, MAX_LINE) });
    }
  }
  // The reading lines repeat by the hundred: the tail keeps what is not one of them, and the last of them.
  const other = lines.filter((l) => !/^\s*lidos \d+ de \d+/.test(l));
  log.tail = other.slice(-TAIL_LINES).map((l) => l.slice(0, MAX_LINE));
  return log;
}

export type LocalLoadPhase = "rodando" | "concluida" | "falhou";

/** Where a load stands: still running, published, or stopped before publishing. */
export function loadPhase(alive: boolean, log: LoadLog): LocalLoadPhase {
  if (log.published) return "concluida";
  return alive ? "rodando" : "falhou";
}

/** What a folder of this machine has for the files a dashboard keeps in the bucket. */
export interface FolderCheck {
  folder: string;
  /** .txt files found in the folder, all levels. */
  localFiles: number;
  /** Files the dashboard keeps in the bucket. */
  stored: number;
  /** Of those, how many have a local file of the same size, establishment and month (read from disk). */
  storedWithLocal: number;
  /** Files still to read (new, changed, or whose read failed). */
  toRead: number;
  /** Of the files to read, how many will be read from this folder instead of downloaded. */
  toReadFromLocal: number;
}
