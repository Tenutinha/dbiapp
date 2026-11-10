import "server-only";
import { rm } from "node:fs/promises";
import type { InstanceAccess } from "../access";
import type { TableReport } from "../ingest/ingest";
import { storage, StorageKeyError } from "../storage";
import type { BrowseEntryFile } from "../storage-browse";
import type { TemplateTable } from "../templates/schema";
import { checkSize, ingestIntoDraft, requireTemplate, UserFacingError } from "./datasets";
import { matchFolderFiles, type FolderMatch } from "./storage-import-match";

export type { FolderMatch };

export interface FolderPreview {
  /** Folder relative to the organization's storage folder, as typed. */
  folder: string;
  matches: FolderMatch[];
  /** Contract tables with no file of that name in the folder. */
  missing: string[];
}

export interface FolderImport extends FolderPreview {
  reports: TableReport[];
}

async function listFolder(access: InstanceAccess, folder: string): Promise<BrowseEntryFile[]> {
  try {
    const listing = await storage.listOrgFolder(access.org.slug, folder, 1000);
    return listing.files;
  } catch (err) {
    if (err instanceof StorageKeyError) throw new UserFacingError("Pasta inválida. Use nomes simples separados por /, como preparado/deputados.");
    throw err;
  }
}

/** Where prepared files usually go: sub-folders of orgs/<slug>/preparado/. */
export const PREPARED_FOLDER = "preparado";

async function preparedSubfolders(orgSlug: string, base: string): Promise<string[]> {
  try {
    const listing = await storage.listOrgFolder(orgSlug, base, 200);
    return listing.folders.map((f) => `${base}/${f.replace(/\/$/, "")}`);
  } catch (err) {
    console.error("[storage-import] could not list prepared folders", orgSlug, base, err);
    return [];
  }
}

/**
 * Folders offered in the import field: for a client's dashboard, the client's own prepared folders first
 * (clientes/<cliente>/preparado/…), then the organization's (preparado/…). Never throws.
 */
export async function storageFolderSuggestions(orgSlug: string, clientSlug?: string | null): Promise<string[]> {
  const [client, org] = await Promise.all([
    clientSlug ? preparedSubfolders(orgSlug, `clientes/${clientSlug}/${PREPARED_FOLDER}`) : Promise.resolve([]),
    preparedSubfolders(orgSlug, PREPARED_FOLDER),
  ]);
  return [...client, ...org];
}

/** Which files of an organization folder would feed which contract tables (nothing is read yet). */
export async function previewFolder(access: InstanceAccess, folder: string): Promise<FolderPreview> {
  const template = await requireTemplate(access.templateId);
  const files = await listFolder(access, folder);
  return { folder, ...matchFolderFiles(template.tables.map((t) => t.name), files) };
}

async function importOne(access: InstanceAccess, table: TemplateTable, match: FolderMatch): Promise<TableReport> {
  checkSize(match.sizeBytes);
  const local = await storage.localPath(match.key).catch(() => {
    throw new UserFacingError(`Não foi possível ler ${match.fileName} no armazenamento.`);
  });
  try {
    return await ingestIntoDraft(access, table, local, match.fileName);
  } finally {
    // Remote drivers keep a downloaded copy in the work folder: drop it (the bucket keeps the original).
    if (storage.remote()) await rm(local, { force: true }).catch(() => undefined);
  }
}

/**
 * Imports every file of an organization folder named after a contract table (f_votacao.parquet,
 * d_municipio.csv…) into the dashboard's draft, with the same validation as an upload. Files are read
 * where they already are in the organization's storage: only the folder comes from the request, and
 * listing it can never leave orgs/<slug>/.
 */
export async function importFolder(access: InstanceAccess, folder: string): Promise<FolderImport> {
  const template = await requireTemplate(access.templateId);
  const preview = await previewFolder(access, folder);
  if (preview.matches.length === 0) {
    throw new UserFacingError("Nenhum arquivo dessa pasta tem o nome de uma tabela do dashboard.");
  }
  const reports: TableReport[] = [];
  for (const match of preview.matches) {
    const table = template.tables.find((t) => t.name === match.table);
    if (table) reports.push(await importOne(access, table, match));
  }
  return { ...preview, reports };
}
