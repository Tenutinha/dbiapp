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
  /** How long the file took, in ms. */
  ms?: number;
}

/** One table put together from the parts. */
export interface TableEvent {
  table: string;
  ok: boolean;
  rows: number;
  sizeBytes: number;
  /** How long the table took, in ms. */
  ms?: number;
}

/**
 * One step of the load, as it happens. "quebra": an original file being read into one Parquet per block;
 * "uniao": the parts of every file being put together into a table; "publicacao": the tables going live.
 * A file's end is the `arquivo` event and a table's end the `tabela` event.
 */
export type StepEvent =
  | { etapa: "quebra"; passo: "inicio"; cnpj: string; periodo: string; sizeBytes: number; origem: "disco" | "bucket"; posicao: number; total: number }
  | { etapa: "quebra"; passo: "lendo"; cnpj: string; periodo: string; linhas: number }
  | { etapa: "quebra"; passo: "bloco"; cnpj: string; periodo: string; tabela: string; linhas: number }
  | { etapa: "uniao"; passo: "inicio"; tabela: string; partes: number; posicao: number; total: number }
  | { etapa: "uniao"; passo: "partes"; tabela: string; feitas: number; total: number }
  | { etapa: "uniao"; passo: "juntando"; tabela: string; ano?: string }
  | { etapa: "uniao"; passo: "ano"; tabela: string; ano: string; linhas: number; reaproveitado: boolean }
  | { etapa: "uniao"; passo: "validando"; tabela: string }
  | { etapa: "publicacao"; passo: "inicio" }
  | { etapa: "publicacao"; passo: "fim"; avisos: string[] };

export type LoadEvent = { arquivo: FileEvent } | { tabela: TableEvent } | { passo: StepEvent };

/** What the load prints for the screen, one line each, after this mark (see `eventLine`). */
export const EVENT_MARK = "@evento ";

export const eventLine = (event: LoadEvent): string => `${EVENT_MARK}${JSON.stringify(event)}`;

const n = (value: number): string => value.toLocaleString("pt-BR");
const mb = (bytes: number): string => `${(bytes / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const seconds = (ms: number | undefined): string => (ms === undefined ? "" : ` em ${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);
const month = (periodo: string): string => `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}`;

/** One event in words, as the screen's terminal shows it. */
export function describeEvent(event: LoadEvent): string {
  if ("arquivo" in event) {
    const f = event.arquivo;
    const where = `${f.cnpj} ${month(f.periodo)}`;
    if (!f.ok) return `✕ ${where}: não foi lido — ${f.error ?? "erro"}`;
    const rows = Object.values(f.rows).reduce((sum, r) => sum + r, 0);
    return `✓ ${where}: pronto, ${n(rows)} linhas em ${n(Object.values(f.rows).filter((r) => r > 0).length)} tabelas${seconds(f.ms)}`;
  }
  if ("tabela" in event) {
    const t = event.tabela;
    return t.ok ? `✓ ${t.table}: tabela pronta, ${n(t.rows)} linhas, ${mb(t.sizeBytes)}${seconds(t.ms)}` : `✕ ${t.table}: a tabela não passou na validação`;
  }
  const s = event.passo;
  if (s.etapa === "quebra") {
    const where = `${s.cnpj} ${month(s.periodo)}`;
    if (s.passo === "inicio") return `▶ arquivo ${n(s.posicao)} de ${n(s.total)} · ${where} · ${mb(s.sizeBytes)} · ${s.origem === "disco" ? "lido do disco desta máquina" : "baixado do bucket"}`;
    if (s.passo === "lendo") return `  ${where}: ${n(s.linhas)} linhas lidas`;
    return `  ${where}: bloco ${s.tabela} gravado, ${n(s.linhas)} linhas`;
  }
  if (s.etapa === "uniao") {
    if (s.passo === "inicio") return `▶ tabela ${n(s.posicao)} de ${n(s.total)} · ${s.tabela} · unindo ${n(s.partes)} parte(s)`;
    if (s.passo === "partes") return `  ${s.tabela}: ${n(s.feitas)} de ${n(s.total)} partes reunidas`;
    if (s.passo === "juntando") return `  ${s.tabela}: juntando e ordenando${s.ano ? ` o ano ${s.ano}` : ""}`;
    if (s.passo === "ano") return `  ${s.tabela}: ano ${s.ano} ${s.reaproveitado ? "sem mudança, reaproveitado" : "gravado"}, ${n(s.linhas)} linhas`;
    return `  ${s.tabela}: validando`;
  }
  if (s.passo === "inicio") return "▶ publicando as tabelas no dashboard";
  return `✓ publicado${s.avisos.length > 0 ? ` com ${n(s.avisos.length)} aviso(s)` : ""}`;
}

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
  /** The step the load is in (null: it reports no steps). */
  stage: StepEvent["etapa"] | null;
  /** Files this run has to read (null: it has not started reading, or has nothing to read). */
  filesTotal: number | null;
  /** Tables this run puts together (null: it has not got there yet). */
  tablesTotal: number | null;
  /** The file being read now, with the lines read so far and the blocks already written. */
  file: { cnpj: string; periodo: string; sizeBytes: number; origem: "disco" | "bucket"; posicao: number; total: number; linhas: number; blocos: { tabela: string; linhas: number }[] } | null;
  /** The table being put together now. */
  table: { tabela: string; posicao: number; total: number; partes: number; feitas: number; fase: "reunindo" | "juntando" | "validando"; anos: { ano: string; linhas: number; reaproveitado: boolean }[] } | null;
  /** The steps in words, the oldest first: what the screen's terminal shows. */
  feed: string[];
}

const RECENT_FILES = 12;
/** Lines the terminal keeps (a chain of stores writes tens of thousands of steps). */
const FEED_LINES = 300;

type FileNow = NonNullable<LiveCount["file"]>;
type TableNow = NonNullable<LiveCount["table"]>;
type AnyEvent = { arquivo?: FileEvent; tabela?: TableEvent; passo?: StepEvent };

function parseEvent(text: string): AnyEvent | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as AnyEvent) : null;
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
  const feed: string[] = [];
  let stage: LiveCount["stage"] = null;
  let filesTotal: number | null = null;
  let tablesTotal: number | null = null;
  let current: LiveCount["file"] = null;
  let table: LiveCount["table"] = null;
  /** Whether the last line of the feed is a count that the next count of the same thing replaces. */
  let counting: string | null = null;
  const say = (event: LoadEvent, countOf: string | null = null): void => {
    const line = describeEvent(event);
    if (countOf !== null && counting === countOf) feed[feed.length - 1] = line;
    else feed.push(line);
    counting = countOf;
  };
  for (const text of events) {
    const event = parseEvent(text);
    const step = event?.passo;
    if (step && typeof step.etapa === "string" && typeof step.passo === "string") {
      stage = step.etapa;
      if (step.etapa === "quebra") {
        if (step.passo === "inicio") filesTotal = step.total;
        if (step.passo === "inicio") current = { cnpj: step.cnpj, periodo: step.periodo, sizeBytes: step.sizeBytes, origem: step.origem, posicao: step.posicao, total: step.total, linhas: 0, blocos: [] };
        else {
          const now = current as FileNow | null;
          if (now && now.cnpj === step.cnpj && now.periodo === step.periodo) {
            current = step.passo === "lendo" ? { ...now, linhas: step.linhas } : { ...now, blocos: [...now.blocos, { tabela: step.tabela, linhas: step.linhas }] };
          }
        }
        say({ passo: step }, step.passo === "lendo" ? `lendo ${step.cnpj} ${step.periodo}` : null);
      } else if (step.etapa === "uniao") {
        current = null;
        if (step.passo === "inicio") tablesTotal = step.total;
        if (step.passo === "inicio") table = { tabela: step.tabela, posicao: step.posicao, total: step.total, partes: step.partes, feitas: 0, fase: "reunindo", anos: [] };
        else {
          const now = table as TableNow | null;
          if (now && now.tabela === step.tabela) {
            if (step.passo === "partes") table = { ...now, feitas: step.feitas };
            else if (step.passo === "juntando") table = { ...now, fase: "juntando" };
            else if (step.passo === "validando") table = { ...now, fase: "validando" };
            else if (step.passo === "ano") table = { ...now, anos: [...now.anos, { ano: step.ano, linhas: step.linhas, reaproveitado: step.reaproveitado }] };
          }
        }
        say({ passo: step }, step.passo === "partes" ? `partes ${step.tabela}` : null);
      } else {
        current = null;
        table = null;
        say({ passo: step });
      }
      continue;
    }
    if (event?.tabela && typeof event.tabela.table === "string") {
      assembled.push(event.tabela);
      say({ tabela: event.tabela });
      if ((table as TableNow | null)?.tabela === event.tabela.table) table = null;
    }
    const file = event?.arquivo;
    if (!file || typeof file.cnpj !== "string") continue;
    files.push(file);
    say({ arquivo: file });
    const reading = current as FileNow | null;
    if (reading?.cnpj === file.cnpj && reading.periodo === file.periodo) current = null;
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
    stage,
    filesTotal,
    tablesTotal,
    file: current,
    table,
    feed: feed.slice(-FEED_LINES),
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
