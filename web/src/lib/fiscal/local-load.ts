/**
 * The load of a fiscal dashboard started from the screen on a machine that keeps the original files
 * (see services/local-load.ts): what the screen shows of it. Pure — the log the load prints is the same the
 * script prints on a terminal (scripts/fiscal/carregar-fiscal.ts), read here into steps and tables.
 */

/** One raw file read (or refused), as the load reports it while it runs. */
export interface FileEvent {
  cnpj: string;
  /** aaaa-mm */
  periodo: string;
  sizeBytes: number;
  ok: boolean;
  /** Lines the file brought to each table (facts and dimensions). */
  rows: Record<string, number>;
  error?: string;
}

/** One table put together from the parts. */
export interface TableEvent {
  table: string;
  ok: boolean;
  rows: number;
  sizeBytes: number;
}

/** What the load prints for the screen, one line each, after this mark (see `eventLine`). */
export const EVENT_MARK = "@evento ";

export const eventLine = (event: { arquivo: FileEvent } | { tabela: TableEvent }): string => `${EVENT_MARK}${JSON.stringify(event)}`;

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
  /** Live count of what was read in this run (null: the load does not report file by file). */
  live: LiveCount | null;
}

export interface LiveCount {
  files: number;
  failed: number;
  bytes: number;
  /** Lines read into every table, in this run. */
  rows: number;
  /** Lines per table, the biggest first. */
  byTable: { table: string; rows: number; files: number }[];
  /** The last files read, the newest first. */
  recent: FileEvent[];
  /** Tables already put together, in the order they ended. */
  assembled: TableEvent[];
}

const RECENT_FILES = 12;

function parseEvent(text: string): { arquivo?: FileEvent; tabela?: TableEvent } | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as { arquivo?: FileEvent; tabela?: TableEvent }) : null;
  } catch {
    return null; // a line cut in the middle while the load was writing it
  }
}

/** Adds up the events of a run. */
function countLive(events: readonly string[]): LiveCount | null {
  if (events.length === 0) return null;
  const perTable = new Map<string, { rows: number; files: number }>();
  const files: FileEvent[] = [];
  const assembled: TableEvent[] = [];
  for (const text of events) {
    const event = parseEvent(text);
    if (event?.tabela && typeof event.tabela.table === "string") assembled.push(event.tabela);
    const file = event?.arquivo;
    if (!file || typeof file.cnpj !== "string") continue;
    files.push(file);
    for (const [table, rows] of Object.entries(file.rows ?? {})) {
      if (typeof rows !== "number" || rows <= 0) continue;
      const sum = perTable.get(table) ?? { rows: 0, files: 0 };
      perTable.set(table, { rows: sum.rows + rows, files: sum.files + 1 });
    }
  }
  const byTable = [...perTable.entries()].map(([table, sum]) => ({ table, ...sum })).sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
  return {
    files: files.length,
    failed: files.filter((f) => !f.ok).length,
    bytes: files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0),
    rows: byTable.reduce((sum, t) => sum + t.rows, 0),
    byTable,
    recent: files.slice(-RECENT_FILES).reverse(),
    assembled,
  };
}

const TAIL_LINES = 12;
const MAX_LINE = 300;

/** Reads the load's output into what the screen shows. */
export function parseLoadLog(text: string): LoadLog {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const log: LoadLog = { read: null, summary: null, tables: [], warnings: [], published: false, tail: [], live: null };
  const events: string[] = [];
  for (const line of lines) {
    if (line.startsWith(EVENT_MARK)) {
      events.push(line.slice(EVENT_MARK.length));
      continue;
    }
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
  log.live = countLive(events);
  const other = lines.filter((l) => !l.startsWith(EVENT_MARK) && !/^\s*lidos \d+ de \d+/.test(l));
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
