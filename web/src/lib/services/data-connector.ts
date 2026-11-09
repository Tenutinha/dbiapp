import "server-only";
import { rm } from "node:fs/promises";
import type { InstanceAccess } from "../access";
import { describeSource, type TableReport } from "../ingest/ingest";
import { checkSchema, type SchemaCheck } from "../ingest/schema-check";
import { storage, StorageKeyError } from "../storage";
import type { BrowseEntryFile } from "../storage-browse";
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
}

export interface FolderFiles {
  folder: string;
  /** Data files (.parquet, .csv, .txt) of the folder. */
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
  const files = list.files.filter((f) => DATA_FILE.test(f.name));
  const { matches } = matchFolderFiles(template.tables.map((t) => t.name), files);
  return {
    folder,
    files: files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt })),
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

/** Engages one file into one table of the draft, with the same validation as an upload. */
export async function engageConnection(
  access: InstanceAccess, folder: string, fileName: string, tableName: string,
): Promise<TableReport> {
  const { table, file }: { table: TemplateTable; file: BrowseEntryFile } = await resolve(access, folder, fileName, tableName);
  return withLocalCopy(file, (local) => ingestIntoDraft(access, table, local, file.name));
}
