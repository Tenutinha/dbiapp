/**
 * Which raw SPED files a dashboard still has to read, and which of its tables' parts can be reused.
 *
 * Every raw file (one company, one period) is read once into its own "parts": one small Parquet per table
 * of the template, kept in a folder of the dashboard named after the file's content. A marker file, written
 * last, says the folder is complete. Adding a month then reads only that month; replacing a month's file
 * (a retificadora) makes its folder obsolete. Pure: the service lists the storage and does the work.
 */
import { createHash } from "node:crypto";

/** A raw file as stored: <fiscal folder>/<cnpj>/<aaaa-mm>/<name>. */
export interface RawFile {
  key: string;
  name: string;
  cnpj: string;
  periodo: string;
  sizeBytes: number;
  /** When the object was last written (ISO); with the size, tells a replaced file from the same one. */
  updatedAt: string | null;
}

/** What a complete parts folder holds (its marker). */
export interface PartsMarker {
  /** SPED_READER_VERSION the parts were read with. */
  reader: number;
  source: { key: string; sizeBytes: number; updatedAt: string | null };
  /** Table → its part (null when the file brings no line for it) and how many lines. */
  tables: Record<string, { key: string | null; rows: number }>;
  /** Dimension rows the file brought, merged into the dimensions when publishing (table → part, lines). */
  dimensions: Record<string, { key: string | null; rows: number }>;
}

/** A parts folder found in storage: <parts folder>/<cnpj>/<aaaa-mm>/<id>/. */
export interface PartsFolder {
  cnpj: string;
  periodo: string;
  id: string;
  /** Null when the folder has no marker (an interrupted read). */
  marker: PartsMarker | null;
}

export interface PartsPlan {
  /** Files to read now. */
  read: RawFile[];
  /** Files whose parts are complete and current. */
  ready: { file: RawFile; marker: PartsMarker }[];
  /** Folders nobody needs any more: replaced or deleted files, older readers, interrupted reads. */
  obsolete: PartsFolder[];
}

/** Name of the parts folder of a raw file: changes with its content and with the reader. */
export function partsFolderId(file: RawFile, reader: number): string {
  const digest = createHash("sha1")
    .update(`${file.key}\n${file.sizeBytes}\n${file.updatedAt ?? ""}\n${reader}`)
    .digest("hex");
  return digest.slice(0, 16);
}

/**
 * The plan: a file is ready when its folder (same content, same reader) has a marker listing every table
 * the template now asks for; otherwise it is read again. Folders that match no stored file are obsolete,
 * and so is an incomplete folder of a file that will be read again.
 */
export function planParts(
  files: readonly RawFile[], folders: readonly PartsFolder[], tables: readonly string[], reader: number,
): PartsPlan {
  const byPlace = new Map(folders.map((f) => [`${f.cnpj}/${f.periodo}/${f.id}`, f]));
  const kept = new Set<string>();
  const read: RawFile[] = [];
  const ready: PartsPlan["ready"] = [];
  for (const file of files) {
    const place = `${file.cnpj}/${file.periodo}/${partsFolderId(file, reader)}`;
    const folder = byPlace.get(place);
    const marker = folder?.marker;
    if (marker && marker.reader === reader && tables.every((t) => t in marker.tables)) {
      ready.push({ file, marker });
      kept.add(place);
    } else {
      read.push(file);
    }
  }
  const obsolete = folders.filter((f) => !kept.has(`${f.cnpj}/${f.periodo}/${f.id}`));
  return { read, ready, obsolete };
}

/**
 * The files whose parts make up a fact table: all of them, or only each company's latest period (a main
 * fact that holds the whole file, too heavy to keep for every period).
 */
export function filesForFact<T extends { file: RawFile }>(ready: readonly T[], periods: "all" | "latest"): T[] {
  if (periods === "all") return [...ready];
  const latest = new Map<string, string>();
  for (const r of ready) {
    const seen = latest.get(r.file.cnpj);
    if (!seen || r.file.periodo > seen) latest.set(r.file.cnpj, r.file.periodo);
  }
  return ready.filter((r) => latest.get(r.file.cnpj) === r.file.periodo);
}

/** Checks a marker read back from storage (it is data, it may be from an older release or broken). */
export function parseMarker(value: unknown): PartsMarker | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<PartsMarker>;
  const isTableMap = (x: unknown): x is PartsMarker["tables"] =>
    !!x && typeof x === "object" && Object.values(x).every((t) =>
      !!t && typeof t === "object" && (t.key === null || typeof t.key === "string") && typeof t.rows === "number");
  if (typeof m.reader !== "number" || !m.source || typeof m.source.key !== "string") return null;
  if (!isTableMap(m.tables) || !isTableMap(m.dimensions)) return null;
  return m as PartsMarker;
}
