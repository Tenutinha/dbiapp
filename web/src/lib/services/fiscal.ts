/**
 * Raw fiscal files (SPED .txt, NF-e .xml) of dashboards built on the fiscal templates.
 *
 *   1. upload  — the file goes to the bucket like any upload (signed URL, or the request body locally);
 *   2. store   — it is identified (company, period, document) and kept, organized, under
 *                orgs/<org>/clientes/<cliente>/fiscal/<molde>/<cnpj>/<aaaa-mm>/ (or orgs/<org>/fiscal/… for
 *                the organization's own dashboards); a newer copy of the same document
 *                (the month's SPED, an NF-e key) replaces the old one;
 *   3. rebuild — SPED: each stored file is read once into its own parts and the draft's tables are put
 *                together from them, so only new or changed files are read (services/fiscal-parts.ts);
 *                NF-e: every stored file is read again. Both go through the regular ingest (same validation
 *                as a table upload). Publishing stays manual.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../access";
import { toCsv } from "../fiscal/csv";
import {
  checkExtension, fiscalImporterFor, mergeTables, SPED_HEAD_BYTES,
  type FiscalIdentity, type FiscalImporter, type FiscalTables,
} from "../fiscal/importers";
import type { RawFile } from "../fiscal/parts-plan";
import { FiscalFileError, type Row } from "../fiscal/sped";
import type { TableReport } from "../ingest/ingest";
import type { TemplateTable } from "../templates/schema";
import { storage } from "../storage";
import { relativeToOrg } from "../storage-browse";
import { isSameFiscalDocument } from "../storage-analysis";
import { fiscalFolder, fiscalNamedKey, fiscalPeriodFolder, isIssuedFiscalUploadKey, spaceFolder } from "../storage-keys";
import { checkSize, ingestIntoDraft, requireTemplate, UserFacingError, type UploadPlan } from "./datasets";
import { rebuildSpedFromParts } from "./fiscal-parts";

/** Files listed per period folder (one month of NF-e can hold thousands of documents). */
const MAX_FILES_PER_FOLDER = 20_000;
const XML_MIME = "application/xml";
const TXT_MIME = "text/plain";

export function fiscalImporter(access: Pick<InstanceAccess, "templateId">): FiscalImporter | null {
  return fiscalImporterFor(access.templateId);
}

export function requireImporter(access: InstanceAccess): FiscalImporter {
  const importer = fiscalImporter(access);
  if (!importer) throw new UserFacingError("Este dashboard não recebe arquivos fiscais.");
  return importer;
}

/** The dashboard's folder of raw files, inside its space's folder (the client's, or the organization's). */
function folderOf(access: Pick<InstanceAccess, "org" | "client" | "templateId">): string {
  return fiscalFolder(access.org.slug, access.client?.slug || null, access.templateId);
}

const extOf = (importer: FiscalImporter, fileName: string): "txt" | "xml" =>
  checkExtension(importer, fileName) === ".xml" ? "xml" : "txt";

function asUserError(err: unknown): never {
  if (err instanceof FiscalFileError) throw new UserFacingError(err.message);
  throw err;
}

export async function planFiscalUpload(access: InstanceAccess, fileName: string, size: number): Promise<UploadPlan> {
  const importer = requireImporter(access);
  checkSize(size);
  let ext: "txt" | "xml";
  try {
    ext = extOf(importer, fileName);
  } catch (err) {
    asUserError(err);
  }
  const target = await storage.createUploadTarget(storage.uploadKey(access.org.slug, access.instanceId, ext));
  return target ? { mode: "signed", key: target.key, signedUrl: target.signedUrl } : { mode: "direct" };
}

export interface StoredFiscalFile {
  cnpj: string;
  periodo: string;
  label: string;
  /** Key relative to the organization's folder, as the administration shows it. */
  path: string;
  /** Whether it replaced an older copy of the same document. */
  replaced: boolean;
}

/** Identifies the file and keeps it in its company/period folder, replacing an older copy of the same document. */
async function store(access: InstanceAccess, bytes: Uint8Array, fileName: string): Promise<StoredFiscalFile> {
  const importer = requireImporter(access);
  let ext: "txt" | "xml";
  let id: ReturnType<FiscalImporter["identify"]>;
  try {
    ext = extOf(importer, fileName);
    id = importer.identify(bytes);
  } catch (err) {
    asUserError(err);
  }
  const { to: key, older } = await placeFiscal(access.org.slug, folderOf(access), fileName, id, null);

  await storage.putBytes(key, bytes, ext === "xml" ? XML_MIME : TXT_MIME);
  // Only after the new copy is safe (one with the same name was just overwritten by it).
  await storage.remove(older.filter((k) => k !== key));
  return { cnpj: id.cnpj, periodo: id.periodo, label: id.label, path: relativeToOrg(access.org.slug, key), replaced: older.length > 0 };
}

/** Local storage: the file came in the request body. */
export async function storeFiscalFile(access: InstanceAccess, file: File): Promise<StoredFiscalFile> {
  checkSize(file.size);
  return store(access, new Uint8Array(await file.arrayBuffer()), file.name);
}

/** Cloud storage: the browser already put the file in the bucket under an upload key we issued. */
export async function storeFiscalUpload(access: InstanceAccess, key: string, fileName: string): Promise<StoredFiscalFile> {
  if (!isIssuedFiscalUploadKey(key, access.org.slug, access.instanceId)) {
    throw new UserFacingError("Envio inválido. Tente novamente.");
  }
  try {
    const bytes = await storage.read(key).catch(() => {
      throw new UserFacingError("Arquivo não encontrado no armazenamento. Envie de novo.");
    });
    return await store(access, bytes, fileName);
  } finally {
    await storage.remove([key]);
  }
}

export interface FiscalPeriod {
  cnpj: string;
  periodo: string;
  files: number;
  sizeBytes: number;
}

const TAX_ID = /^\d{11,14}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What a model's fiscal folder holds: the files in their company/period folders, and the ones dropped at its root. */
export interface StoredFiscalFiles {
  files: RawFile[];
  /** Files at the root of the folder, outside any company/period folder (filed by "Organizar"). */
  loose: RawFile[];
}

/**
 * Every stored file of one model in one space, in one listing of the whole folder (one listing per
 * company and period took seconds for a client with thousands of files).
 */
export async function storedFiscalFiles(orgSlug: string, clientSlug: string | null, templateId: string): Promise<StoredFiscalFiles> {
  const folder = fiscalFolder(orgSlug, clientSlug, templateId);
  const files: RawFile[] = [];
  const loose: RawFile[] = [];
  for (const f of await storage.listTree(folder)) {
    const parts = f.key.slice(folder.length).split("/");
    const updatedAt = f.updatedAt ? new Date(f.updatedAt).toISOString() : null;
    if (parts.length === 1) loose.push({ key: f.key, name: f.name, cnpj: "", periodo: "", sizeBytes: f.sizeBytes, updatedAt });
    if (parts.length !== 3 || !TAX_ID.test(parts[0]) || !PERIOD.test(parts[1])) continue;
    files.push({ key: f.key, name: f.name, cnpj: parts[0], periodo: parts[1], sizeBytes: f.sizeBytes, updatedAt });
  }
  return { files, loose };
}

/** Every stored file, grouped by company and period. */
async function walk(access: InstanceAccess): Promise<{
  period: Omit<FiscalPeriod, "files" | "sizeBytes">;
  keys: { key: string; name: string; sizeBytes: number; updatedAt: string | null }[];
}[]> {
  const { files } = await storedFiscalFiles(access.org.slug, access.client?.slug || null, access.templateId);
  const byPeriod = new Map<string, RawFile[]>();
  for (const f of files) byPeriod.set(`${f.cnpj}/${f.periodo}`, [...(byPeriod.get(`${f.cnpj}/${f.periodo}`) ?? []), f]);
  return [...byPeriod.values()].map((list) => ({
    period: { cnpj: list[0].cnpj, periodo: list[0].periodo },
    keys: list.map((f) => ({ key: f.key, name: f.name, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt })),
  }));
}

/**
 * One stored raw file of the dashboard, by its key as the panel sent it back: it must be inside the
 * dashboard's own folder, in a company/period folder, and exist (its size and date come from the bucket).
 */
export async function findStoredFile(access: InstanceAccess, key: string): Promise<RawFile | null> {
  const folder = folderOf(access);
  if (!key.startsWith(folder)) return null;
  const [cnpj, periodo, name, ...rest] = key.slice(folder.length).split("/");
  if (rest.length > 0 || !name || !TAX_ID.test(cnpj) || !PERIOD.test(periodo)) return null;
  const listing = await storage.listOrgFolder(access.org.slug, relativeToOrg(access.org.slug, `${folder}${cnpj}/${periodo}/`), MAX_FILES_PER_FOLDER);
  const found = listing.files.find((f) => f.key === key);
  if (!found) return null;
  return {
    key, name: found.name, cnpj, periodo, sizeBytes: found.sizeBytes,
    updatedAt: found.updatedAt ? new Date(found.updatedAt).toISOString() : null,
  };
}

/** Files left loose at the root of a space's folder whose extension one of the fiscal models accepts. */
export async function looseSpaceFiles(orgSlug: string, clientSlug: string | null, extensions: readonly string[]): Promise<number> {
  const root = relativeToOrg(orgSlug, spaceFolder(orgSlug, clientSlug)).replace(/\/$/, "");
  const listing = await storage.listOrgFolder(orgSlug, root, MAX_FILES_PER_FOLDER);
  return listing.files.filter((f) => extensions.some((ext) => f.name.toLowerCase().endsWith(ext))).length;
}

export async function listFiscalPeriods(access: InstanceAccess): Promise<FiscalPeriod[]> {
  requireImporter(access);
  const folders = await walk(access);
  return folders
    .map(({ period, keys }) => ({ ...period, files: keys.length, sizeBytes: keys.reduce((s, k) => s + k.sizeBytes, 0) }))
    .sort((a, b) => a.cnpj.localeCompare(b.cnpj) || b.periodo.localeCompare(a.periodo));
}

/**
 * Files sent through the connector's Upload step land loose in the space's folder. The ones this
 * dashboard's importer recognizes are moved to their company/period folder (replacing an older copy of
 * the same document); the others stay where they are. Returns how many were filed.
 */
export async function adoptLooseFiles(access: InstanceAccess): Promise<number> {
  const importer = requireImporter(access);
  const spaceRoot = relativeToOrg(access.org.slug, spaceFolder(access.org.slug, access.client?.slug || null)).replace(/\/$/, "");
  const folder = folderOf(access);
  // Also the ones dropped straight into the dashboard's own folder, outside any company/period folder.
  const ownRoot = relativeToOrg(access.org.slug, folder).replace(/\/$/, "");
  const loose = (await Promise.all([spaceRoot, ownRoot].map((root) => storage.listOrgFolder(access.org.slug, root, MAX_FILES_PER_FOLDER))))
    .flatMap((listing) => listing.files)
    .filter((f) => importer.extensions.some((ext) => f.name.toLowerCase().endsWith(ext)));
  let adopted = 0;
  for (const file of loose) {
    let id: FiscalIdentity;
    try {
      const bytes = importer.mode === "sped" ? await storage.readHead(file.key, SPED_HEAD_BYTES) : await storage.read(file.key);
      id = importer.identify(bytes);
    } catch (err) {
      if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not identify", file.key, err);
      continue; // another dashboard's file (or not a fiscal file at all)
    }
    await fileFiscal(access.org.slug, folder, file.key, file.name, id);
    adopted += 1;
  }
  return adopted;
}

/** Where a fiscal file goes in its period folder, keeping its own name, and the older copies it replaces. */
async function placeFiscal(
  orgSlug: string, folder: string, fileName: string, id: FiscalIdentity, self: string | null,
): Promise<{ to: string; older: string[] }> {
  const ext = fileName.toLowerCase().endsWith(".xml") ? "xml" : "txt";
  const period = fiscalPeriodFolder(folder, id.cnpj, id.periodo);
  const existing = (await storage.listOrgFolder(orgSlug, relativeToOrg(orgSlug, period), MAX_FILES_PER_FOLDER)).files
    .filter((f) => f.key !== self);
  const older = existing.filter((f) => isSameFiscalDocument(f.name, id.documentId, ext));
  // Names of the documents that stay: the new file never takes one of them.
  const taken = new Set(existing.filter((f) => !older.includes(f)).map((f) => f.name));
  return { to: fiscalNamedKey(period, fileName, taken), older: older.map((f) => f.key) };
}

/**
 * Files one raw fiscal file in its standard place, <folder><cnpj>/<período>/, with its own name
 * (`folder` = fiscalFolder of its space and template), replacing an older copy of the same document.
 * Shared by the importer ("Montar tabelas") and the file explorer ("Organizar pasta").
 */
export async function fileFiscal(
  orgSlug: string, folder: string, key: string, fileName: string, id: FiscalIdentity,
): Promise<{ key: string; replaced: number; replacedKeys: string[] }> {
  const { to, older } = await placeFiscal(orgSlug, folder, fileName, id, key);
  if (to !== key) await storage.move(key, to);
  // Only after the new copy is in place (an older copy with the same name was just overwritten by it).
  const gone = older.filter((k) => k !== to);
  await storage.remove(gone);
  return { key: to, replaced: older.length, replacedKeys: gone };
}

export interface RebuildResult {
  ok: boolean;
  files: number;
  /** SPED: files read now (new or changed) and files whose tables were reused as they were. */
  read?: number;
  reused?: number;
  /** Loose files of the space's folder that were filed before reading. */
  adopted: number;
  /** Files that could not be read (name → reason); the others still enter the draft. */
  skipped: { path: string; error: string }[];
  tables: TableReport[];
}

/** Raw bytes one serverless request can turn into tables (disk and time are limited there). */
const MAX_HOSTED_REBUILD_BYTES = 250 * 1024 ** 2;
function placeholderRow(table: TemplateTable): Row {
  const row: Row = {};
  for (const c of table.columns) {
    if (c.name === table.key) row[c.name] = "-";
    else if (c.required) {
      row[c.name] = c.type === "text" ? "(sem cadastro)" : c.type === "boolean" ? "false"
        : c.type === "date" || c.type === "timestamp" ? "1970-01-01" : "0";
    }
  }
  return row;
}

export interface RebuildOptions {
  /**
   * "blocks": only the block facts (e.g. bloco A of every period) and the dimensions are put together; the
   * main fact stays as published.
   */
  only?: "blocks";
  /** SPED: reads every file again, also the ones already read. */
  rereadAll?: boolean;
}

/** NF-e and other documents: every stored file is parsed whole and the tables are gathered in memory. */
async function gatherDocuments(
  access: InstanceAccess, importer: Extract<FiscalImporter, { mode: "documents" }>,
): Promise<{ files: number; skipped: RebuildResult["skipped"]; tables: FiscalTables }> {
  const stored = (await walk(access)).flatMap((f) => f.keys);
  const total = stored.reduce((s, f) => s + f.sizeBytes, 0);
  if (process.env.VERCEL && total > MAX_HOSTED_REBUILD_BYTES) {
    throw new UserFacingError(
      `Os arquivos guardados somam ${Math.round(total / 1024 ** 2)} MB, mais do que dá para montar por aqui. Peça à equipe da DBI para processar este volume.`,
    );
  }
  const skipped: RebuildResult["skipped"] = [];
  const parts: FiscalTables[] = [];
  let files = 0;
  for (const f of stored) {
    try {
      parts.push(importer.parse(await storage.read(f.key)));
      files += 1;
    } catch (err) {
      if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not read", f.key, err);
      skipped.push({ path: relativeToOrg(access.org.slug, f.key), error: err instanceof FiscalFileError ? err.message : "não foi possível ler o arquivo" });
    }
  }
  return { files, skipped, tables: mergeTables(importer, parts) };
}

/** The stored raw SPED files, as the parts plan sees them. */
export async function rawFiles(access: InstanceAccess): Promise<RawFile[]> {
  const { files } = await storedFiscalFiles(access.org.slug, access.client?.slug || null, access.templateId);
  return files.filter((f) => f.name.toLowerCase().endsWith(".txt"));
}

/** Files what was uploaded loose, reads every stored file into the template's tables and puts them in the draft. */
export async function rebuildFiscal(access: InstanceAccess, options: RebuildOptions = {}): Promise<RebuildResult> {
  const importer = requireImporter(access);
  const template = await requireTemplate(access.templateId);
  const adopted = await adoptLooseFiles(access);
  if (importer.mode === "sped") {
    // One file at a time, each read once: only new or changed files are read (see services/fiscal-parts.ts).
    const result = await rebuildSpedFromParts(access, importer, template, await rawFiles(access), options);
    return { ...result, adopted };
  }
  const dir = path.join(storage.workRoot, "_fiscal", randomUUID());
  await mkdir(dir, { recursive: true });
  const tables: TableReport[] = [];
  try {
    const gathered = await gatherDocuments(access, importer);
    if (gathered.files === 0) {
      throw new UserFacingError(gathered.skipped.length ? "Nenhum arquivo pôde ser lido." : "Nenhum arquivo enviado ainda.");
    }
    for (const table of template.tables) {
      const file = path.join(dir, `${table.name}.csv`);
      let rows = gathered.tables[table.name] ?? [];
      // The ingest refuses empty files; a dimension nobody references (e.g. NFC-e without recipients) gets one placeholder row.
      if (rows.length === 0 && table.kind === "dimension") rows = [placeholderRow(table)];
      await writeFile(file, toCsv(table.columns.map((c) => c.name), rows), "utf8");
      tables.push(await ingestIntoDraft(access, table, file, `${table.name}.csv`));
    }
    return { ok: tables.every((t) => t.ok), files: gathered.files, adopted, skipped: gathered.skipped, tables };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

