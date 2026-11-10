import "server-only";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../access";
import type { SourceColumn } from "../ingest/contract";
import { describeSource, type TableReport } from "../ingest/ingest";
import { checkSchema, type SchemaCheck } from "../ingest/schema-check";
import { wholeLines } from "../ingest/whole-lines";
import { storage, StorageKeyError } from "../storage";
import type { BrowseEntryFile } from "../storage-browse";
import type { TemplateTable } from "../templates/schema";
import {
  checkSize, convertToPart, detectFormat, discardParts, ingestIntoDraft, registerParts, requireTemplate, UserFacingError,
} from "./datasets";
import { planUpload, storeUpload, type FolderUploadPlan } from "./org-storage";
import { matchFolderFiles } from "./storage-import-match";

/**
 * Server side of the data connector (the "engate" map in the data manager): list the files of an
 * organization folder, check one file's columns against one contract table, and engage it into the
 * draft. Files are always resolved from the server's own listing of orgs/<slug>/<folder> — a name
 * from the request is only looked up there, never turned into a path.
 */

export interface ConnectorFile {
  name: string;
  sizeBytes: number;
  updatedAt: Date | null;
  /** Data file (.parquet, .csv, .txt) that can be wired to a table; other files are only stored. */
  engageable: boolean;
}

export interface FolderFiles {
  folder: string;
  /** Every file of the folder (data files first). */
  files: ConnectorFile[];
  /** Sub-folders, to browse deeper. */
  folders: string[];
  /** Suggested links file → table, by name (f_votacao.parquet → f_votacao). */
  suggestions: { table: string; file: string }[];
}

const DATA_FILE = /\.(parquet|csv|txt)$/i;

async function listing(access: InstanceAccess, folder: string) {
  try {
    return await storage.listOrgFolder(access.org.slug, folder, 1000);
  } catch (err) {
    if (err instanceof StorageKeyError) throw new UserFacingError("Pasta inválida. Use nomes simples separados por /.");
    throw err;
  }
}

export async function listConnectorFolder(access: InstanceAccess, folder: string): Promise<FolderFiles> {
  const template = await requireTemplate(access.templateId);
  const list = await listing(access, folder);
  const visible = list.files.filter((f) => !f.name.endsWith(".emptyFolderPlaceholder") && f.name !== "");
  const dataFiles = visible.filter((f) => DATA_FILE.test(f.name));
  const { matches } = matchFolderFiles(template.tables.map((t) => t.name), dataFiles);
  const files = visible
    .map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt, engageable: DATA_FILE.test(f.name) }))
    .sort((a, b) => Number(b.engageable) - Number(a.engageable) || a.name.localeCompare(b.name));
  return {
    folder,
    files,
    folders: list.folders.map((f) => f.replace(/\/$/, "")),
    suggestions: matches.map((m) => ({ table: m.table, file: m.fileName })),
  };
}

async function resolve(access: InstanceAccess, folder: string, fileName: string, tableName: string) {
  const template = await requireTemplate(access.templateId);
  const table = template.tables.find((t) => t.name === tableName);
  if (!table) throw new UserFacingError("Tabela não faz parte deste dashboard.");
  const file = (await listing(access, folder)).files.find((f) => f.name === fileName);
  if (!file) throw new UserFacingError("Arquivo não encontrado nessa pasta.");
  checkSize(file.sizeBytes);
  return { table, file };
}

/** Reads the file where it is (a remote copy is downloaded to the work folder and dropped afterwards). */
async function withLocalCopy<T>(file: BrowseEntryFile, run: (localPath: string) => Promise<T>): Promise<T> {
  const local = await storage.localPath(file.key).catch(() => {
    throw new UserFacingError(`Não foi possível ler ${file.name} no armazenamento.`);
  });
  try {
    return await run(local);
  } finally {
    if (storage.remote()) await rm(local, { force: true }).catch(() => undefined);
  }
}

/** How much of a big text file is read to see its columns (the header and the first lines are enough). */
const HEAD_BYTES = 8 * 1024 ** 2;

/**
 * Columns of a big text file from its first megabytes only, so that checking several large files does not
 * download each one whole. Null when that piece cannot be read on its own (the whole file is read instead).
 */
async function describeHead(access: InstanceAccess, file: BrowseEntryFile): Promise<SourceColumn[] | null> {
  const key = storage.uploadKey(access.org.slug, access.instanceId, "csv");
  const piece = storage.pathFor(key);
  try {
    const head = await storage.readHead(file.key, HEAD_BYTES);
    const complete = wholeLines(head);
    if (complete === null) return null;
    await mkdir(path.dirname(piece), { recursive: true });
    await writeFile(piece, complete);
    return await describeSource(storage.workRoot, piece, "csv");
  } catch {
    return null;
  } finally {
    await rm(piece, { force: true }).catch(() => undefined);
  }
}

/** Column-by-column check of one file against one table — nothing is converted or saved. */
export async function checkConnection(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<SchemaCheck> {
  const { table, file } = await resolve(access, folder, fileName, tableName);
  const format = detectFormat(file.name);
  if (format === "csv" && file.sizeBytes > HEAD_BYTES) {
    const columns = await describeHead(access, file);
    if (columns) return checkSchema(table, columns);
  }
  return withLocalCopy(file, async (local) => {
    try {
      return checkSchema(table, await describeSource(storage.workRoot, local, format));
    } catch {
      throw new UserFacingError(`Não foi possível ler ${file.name} como ${format.toUpperCase()}.`);
    }
  });
}

// ---------- storing files in the folder (kept in the bucket; engaging is a separate step) ----------

export type { FolderUploadPlan };

export function planFolderUpload(access: InstanceAccess, folder: string, fileName: string, size: number): Promise<FolderUploadPlan> {
  return planUpload(access.org, folder, fileName, size);
}

/** Local storage: the file comes in the request body. */
export function storeFolderFile(access: InstanceAccess, folder: string, file: File): Promise<{ name: string }> {
  return storeUpload(access.org, folder, file);
}

/** Engages one file into one table of the draft, with the same validation as an upload. */
export async function engageConnection(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<TableReport> {
  const { table, file }: { table: TemplateTable; file: BrowseEntryFile } = await resolve(access, folder, fileName, tableName);
  return withLocalCopy(file, (local) => ingestIntoDraft(access, table, local, file.name));
}


// ---------- several files for one table: one request converts each file, a last one makes the table ----------
// Each request handles a single raw file, so the time and the disk a request needs do not grow with the
// number of files. The converted files are not put together in one: the table is read from all of them.

/** A file converted for a table: where the converted Parquet is, and the name of the file it came from. */
export interface ConnectorPart {
  key: string;
  file: string;
}

async function requireTable(access: InstanceAccess, tableName: string): Promise<TemplateTable> {
  const template = await requireTemplate(access.templateId);
  const table = template.tables.find((t) => t.name === tableName);
  if (!table) throw new UserFacingError("Tabela não faz parte deste dashboard.");
  return table;
}

/** Converts one of the files of a table (same validation as engaging it alone); the table is not changed yet. */
export async function convertConnectionPart(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<TableReport & { key?: string }> {
  const { table, file } = await resolve(access, folder, fileName, tableName);
  return withLocalCopy(file, (local) => convertToPart(access, table, local, file.name));
}

/** Makes the table of the draft out of the converted files (it becomes exactly those files). */
export async function joinConnectionParts(
  access: InstanceAccess, tableName: string, parts: readonly ConnectorPart[],
): Promise<TableReport> {
  const table = await requireTable(access, tableName);
  return registerParts(access, table, parts.map((p) => ({ key: p.key, name: p.file })));
}

/** Drops converted files that will not become the table (a later file of the list was refused). */
export async function discardConnectionParts(access: InstanceAccess, tableName: string, keys: readonly string[]): Promise<void> {
  await discardParts(access, await requireTable(access, tableName), keys);
}
