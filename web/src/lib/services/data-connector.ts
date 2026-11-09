import "server-only";
import { rm } from "node:fs/promises";
import type { InstanceAccess } from "../access";
import { describeSource, type TableReport } from "../ingest/ingest";
import { checkSchema, type SchemaCheck } from "../ingest/schema-check";
import { storage, StorageKeyError } from "../storage";
import { browsePrefix, type BrowseEntryFile } from "../storage-browse";
import { STORABLE_EXTENSIONS, storableFileName } from "../storage-keys";
import type { TemplateTable } from "../templates/schema";
import { checkSize, detectFormat, ingestIntoDraft, requireTemplate, UserFacingError } from "./datasets";
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

/** Column-by-column check of one file against one table — nothing is converted or saved. */
export async function checkConnection(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<SchemaCheck> {
  const { table, file } = await resolve(access, folder, fileName, tableName);
  const format = detectFormat(file.name);
  return withLocalCopy(file, async (local) => {
    try {
      return checkSchema(table, await describeSource(storage.workRoot, local, format));
    } catch {
      throw new UserFacingError(`Não foi possível ler ${file.name} como ${format.toUpperCase()}.`);
    }
  });
}

// ---------- storing files in the folder (kept in the bucket; engaging is a separate step) ----------

export type FolderUploadPlan =
  | { mode: "direct"; name: string }
  | { mode: "signed"; name: string; signedUrl: string };

/** A free name in the folder: "notas.xml", then "notas-2.xml", "notas-3.xml"… (stored files are never overwritten). */
function freeName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new UserFacingError("Já existem arquivos demais com esse nome nesta pasta.");
}

/** Key for a new file in the folder, after validating its name, size and the folder itself. */
async function newFileKey(access: InstanceAccess, folder: string, fileName: string, size: number): Promise<{ key: string; name: string }> {
  checkSize(size);
  const safe = storableFileName(fileName);
  if (!safe) throw new UserFacingError(`Tipo de arquivo não aceito. Envie ${STORABLE_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`);
  const list = await listing(access, folder);
  const name = freeName(new Set(list.files.map((f) => f.name)), safe);
  return { key: `${browsePrefix(access.org.slug, folder)}${name}`, name };
}

export async function planFolderUpload(access: InstanceAccess, folder: string, fileName: string, size: number): Promise<FolderUploadPlan> {
  const { key, name } = await newFileKey(access, folder, fileName, size);
  const target = await storage.createUploadTarget(key);
  return target ? { mode: "signed", name, signedUrl: target.signedUrl } : { mode: "direct", name };
}

/** Local storage: the file comes in the request body. */
export async function storeFolderFile(access: InstanceAccess, folder: string, file: File): Promise<{ name: string }> {
  const { key, name } = await newFileKey(access, folder, file.name, file.size);
  await storage.putBytes(key, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream");
  return { name };
}

/** Engages one file into one table of the draft, with the same validation as an upload. */
export async function engageConnection(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<TableReport> {
  const { table, file }: { table: TemplateTable; file: BrowseEntryFile } = await resolve(access, folder, fileName, tableName);
  return withLocalCopy(file, (local) => ingestIntoDraft(access, table, local, file.name));
}
