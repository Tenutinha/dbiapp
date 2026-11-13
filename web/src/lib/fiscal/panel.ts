/**
 * The panel of fiscal data of a space: the path of its fiscal files in three layers, from the original
 * file to the published tables ("gold").
 *
 *   1. original — the .txt / .xml kept in <espaço>/fiscal/<molde>/<CNPJ>/<aaaa-mm>/, and the loose ones;
 *   2. partes   — what was read of each file, in <espaço>/dashboards/<molde>-<id8>/partes/…, with pronto.json;
 *   3. gold     — the Parquet tables each fiscal dashboard publishes, with their linhagem.json.
 *
 * Pure: the service lists the storage; this turns it into the map (what exists per model, company and month,
 * what was read, what is missing, what failed) and into the lineage as the screen shows it.
 */
import type { Lineage, LineageSource, TableLineage } from "./lineage";
import type { PartsFailure, RawFile } from "./parts-plan";

/** Catalog id of the panel: linked to a client like any dashboard, drawn by its own screen. */
export const FISCAL_PANEL_TEMPLATE = "dados-fiscais";

export const isFiscalPanel = (templateId: string): boolean => templateId === FISCAL_PANEL_TEMPLATE;

/**
 * State of one stored file:
 *   pronto  — read (its parts are complete for this content and this reader);
 *   falta   — not read yet, or changed since (a retificadora, a new reader);
 *   erro    — the last read failed (kept until the file changes);
 *   script  — too big for one request of the app: loaded by the script;
 *   guardado — NF-e: kept, and read whole every time the tables are put together (no parts).
 */
export type FileState = "pronto" | "falta" | "erro" | "script" | "guardado";

export interface FileStatus {
  /** Raw key (validated again by the server whenever it comes back from the browser). */
  key: string;
  name: string;
  cnpj: string;
  periodo: string;
  sizeBytes: number;
  state: FileState;
  error?: string;
}

/** The state of each stored file of a SPED model, from what the parts folders hold. */
export function spedFileStatuses(
  files: readonly RawFile[], ready: ReadonlySet<string>, failures: ReadonlyMap<string, PartsFailure>, maxReadBytes: number | null,
): FileStatus[] {
  return files.map((f) => {
    const base = { key: f.key, name: f.name, cnpj: f.cnpj, periodo: f.periodo, sizeBytes: f.sizeBytes };
    if (ready.has(f.key)) return { ...base, state: "pronto" };
    const failure = failures.get(f.key);
    if (failure) return { ...base, state: "erro", error: failure.error };
    if (maxReadBytes !== null && f.sizeBytes > maxReadBytes) return { ...base, state: "script" };
    return { ...base, state: "falta" };
  });
}

/** NF-e and other documents: no parts, every file is read whole when the tables are put together. */
export function documentFileStatuses(files: readonly RawFile[]): FileStatus[] {
  return files.map((f) => ({ key: f.key, name: f.name, cnpj: f.cnpj, periodo: f.periodo, sizeBytes: f.sizeBytes, state: "guardado" }));
}

/** Worst first: a cell shows the state that asks for attention. */
const SEVERITY: Record<FileState, number> = { erro: 4, script: 3, falta: 2, guardado: 1, pronto: 0 };

export interface MapCell {
  state: FileState;
  files: number;
  sizeBytes: number;
}

export interface FileMap {
  /** Companies (CNPJ), in order. */
  companies: string[];
  /** Every month from the first to the last one with a file (aaaa-mm), gaps included. */
  periods: string[];
  /** "<cnpj>|<aaaa-mm>" → the cell; months without a file have none. */
  cells: Record<string, MapCell>;
}

/** Months from `first` to `last` (aaaa-mm), both included. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  // A guard against a broken period: never more than 50 years of months.
  while ((y < ly || (y === ly && m <= lm)) && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The map of a model: one row per company, one column per month, each cell the worst state of its files. */
export function fileMap(statuses: readonly FileStatus[]): FileMap {
  const cells: Record<string, MapCell> = {};
  for (const s of statuses) {
    const id = `${s.cnpj}|${s.periodo}`;
    const cell = cells[id];
    cells[id] = cell
      ? {
        state: SEVERITY[s.state] > SEVERITY[cell.state] ? s.state : cell.state,
        files: cell.files + 1,
        sizeBytes: cell.sizeBytes + s.sizeBytes,
      }
      : { state: s.state, files: 1, sizeBytes: s.sizeBytes };
  }
  const periods = [...new Set(statuses.map((s) => s.periodo))].sort();
  return {
    companies: [...new Set(statuses.map((s) => s.cnpj))].sort(),
    periods: periods.length > 0 ? monthsBetween(periods[0], periods[periods.length - 1]) : [],
    cells,
  };
}

export type StateCounts = Record<FileState, number>;

export function countStates(statuses: readonly FileStatus[]): StateCounts {
  const counts: StateCounts = { pronto: 0, falta: 0, erro: 0, script: 0, guardado: 0 };
  for (const s of statuses) counts[s.state] += 1;
  return counts;
}

/** The files the panel reads one by one, oldest month first (what is missing, then what failed, to try again). */
export function filesToRead(statuses: readonly FileStatus[], retryFailed: boolean): FileStatus[] {
  return statuses
    .filter((s) => s.state === "falta" || (retryFailed && s.state === "erro"))
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.cnpj.localeCompare(b.cnpj) || a.key.localeCompare(b.key));
}

/** One table of the lineage, summed up for the screen (the sources themselves come page by page). */
export interface LineageTableView {
  table: string;
  kind: TableLineage["kind"];
  how: string[];
  rows: number | null;
  files: number;
  companies: number;
  /** First and last month of the files it came from. */
  from: string | null;
  to: string | null;
}

export function lineageTableView(t: TableLineage): LineageTableView {
  const periods = t.sources.map((s) => s.periodo).sort();
  return {
    table: t.table, kind: t.kind, how: t.how, rows: t.rows, files: t.sources.length,
    companies: new Set(t.sources.map((s) => s.cnpj)).size,
    from: periods[0] ?? null, to: periods[periods.length - 1] ?? null,
  };
}

/** A page of a table's sources, newest month first. */
export function lineageSourcesPage(t: TableLineage, offset: number, limit: number): { total: number; sources: LineageSource[] } {
  const sorted = [...t.sources].sort((a, b) => b.periodo.localeCompare(a.periodo) || a.cnpj.localeCompare(b.cnpj) || a.file.localeCompare(b.file));
  return { total: sorted.length, sources: sorted.slice(offset, offset + limit) };
}

/** Checks a lineage read back from storage (data written by an older release, or broken). */
export function parseLineage(value: unknown): Lineage | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Partial<Lineage>;
  if (typeof l.builtAt !== "string" || typeof l.template !== "string" || typeof l.reader !== "number" || !Array.isArray(l.tables)) return null;
  const tableOk = (t: unknown): t is TableLineage => {
    const x = t as Partial<TableLineage> | null;
    return !!x && typeof x.table === "string" && (x.kind === "fact" || x.kind === "dimension")
      && Array.isArray(x.how) && Array.isArray(x.sources)
      && x.sources.every((s) => !!s && typeof s.file === "string" && typeof s.cnpj === "string" && typeof s.periodo === "string" && typeof s.rows === "number");
  };
  return l.tables.every(tableOk) ? (l as Lineage) : null;
}
