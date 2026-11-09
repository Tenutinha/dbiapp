/**
 * Raw fiscal files (SPED .txt, NF-e .xml) of dashboards built on the fiscal templates.
 *
 *   1. upload  — the file goes to the bucket like any upload (signed URL, or the request body locally);
 *   2. store   — it is identified (company, period, document) and kept, organized, under
 *                orgs/<org>/fiscal/<espaço>/<molde>/<cnpj>/<aaaa-mm>/; a newer copy of the same document
 *                (the month's SPED, an NF-e key) replaces the old one;
 *   3. rebuild — every stored file is read again into the template's tables, which enter the draft
 *                through the regular ingest (same validation as a table upload). Publishing stays manual.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../access";
import { toCsv } from "../fiscal/csv";
import { checkExtension, fiscalImporterFor, mergeTables, type FiscalImporter, type FiscalTables } from "../fiscal/importers";
import { FiscalFileError, type Row } from "../fiscal/sped";
import type { TableReport } from "../ingest/ingest";
import type { TemplateTable } from "../templates/schema";
import { storage } from "../storage";
import { relativeToOrg } from "../storage-browse";
import { fiscalDocumentId, fiscalFileKey, fiscalFolder, isIssuedFiscalUploadKey } from "../storage-keys";
import { checkSize, ingestIntoDraft, requireTemplate, UserFacingError, type UploadPlan } from "./datasets";

/** Files listed per period folder (one month of NF-e can hold thousands of documents). */
const MAX_FILES_PER_FOLDER = 20_000;
const XML_MIME = "application/xml";
const TXT_MIME = "text/plain";

export function fiscalImporter(access: InstanceAccess): FiscalImporter | null {
  return fiscalImporterFor(access.templateId);
}

function requireImporter(access: InstanceAccess): FiscalImporter {
  const importer = fiscalImporter(access);
  if (!importer) throw new UserFacingError("Este dashboard não recebe arquivos fiscais.");
  return importer;
}

/** The dashboard's folder of raw files: one per space (client) and model. */
function folderOf(access: InstanceAccess): string {
  return fiscalFolder(access.org.slug, access.client?.slug || "organizacao", access.templateId);
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
  const folder = folderOf(access);
  const key = fiscalFileKey(folder, id.cnpj, id.periodo, id.documentId, ext);
  const periodFolder = relativeToOrg(access.org.slug, `${folder}${id.cnpj}/${id.periodo}`);
  const existing = await storage.listOrgFolder(access.org.slug, periodFolder, MAX_FILES_PER_FOLDER);
  const older = existing.files.filter((f) => fiscalDocumentId(f.name) === id.documentId).map((f) => f.key);

  await storage.putBytes(key, bytes, ext === "xml" ? XML_MIME : TXT_MIME);
  // Only after the new copy is safe.
  await storage.remove(older);
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

/** Every stored file, walking company → period folders. */
async function walk(access: InstanceAccess): Promise<{ period: Omit<FiscalPeriod, "files" | "sizeBytes">; keys: { key: string; name: string; sizeBytes: number }[] }[]> {
  const base = relativeToOrg(access.org.slug, folderOf(access)).replace(/\/$/, "");
  const companies = await storage.listOrgFolder(access.org.slug, base);
  const out = [];
  for (const cnpj of companies.folders) {
    const periods = await storage.listOrgFolder(access.org.slug, `${base}/${cnpj}`);
    for (const periodo of periods.folders) {
      const files = await storage.listOrgFolder(access.org.slug, `${base}/${cnpj}/${periodo}`, MAX_FILES_PER_FOLDER);
      if (files.files.length === 0) continue;
      out.push({ period: { cnpj, periodo }, keys: files.files.map((f) => ({ key: f.key, name: f.name, sizeBytes: f.sizeBytes })) });
    }
  }
  return out;
}

export async function listFiscalPeriods(access: InstanceAccess): Promise<FiscalPeriod[]> {
  requireImporter(access);
  const folders = await walk(access);
  return folders
    .map(({ period, keys }) => ({ ...period, files: keys.length, sizeBytes: keys.reduce((s, k) => s + k.sizeBytes, 0) }))
    .sort((a, b) => a.cnpj.localeCompare(b.cnpj) || b.periodo.localeCompare(a.periodo));
}

export interface RebuildResult {
  ok: boolean;
  files: number;
  /** Files that could not be read (name → reason); the others still enter the draft. */
  skipped: { path: string; error: string }[];
  tables: TableReport[];
}

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

/** Reads every stored file into the template's tables and puts them in the draft. */
export async function rebuildFiscal(access: InstanceAccess): Promise<RebuildResult> {
  const importer = requireImporter(access);
  const template = await requireTemplate(access.templateId);
  const folders = await walk(access);
  const parts: FiscalTables[] = [];
  const skipped: RebuildResult["skipped"] = [];
  for (const { keys } of folders) {
    for (const f of keys) {
      try {
        parts.push(importer.parse(await storage.read(f.key)));
      } catch (err) {
        const reason = err instanceof FiscalFileError ? err.message : "não foi possível ler o arquivo";
        if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not read", f.key, err);
        skipped.push({ path: relativeToOrg(access.org.slug, f.key), error: reason });
      }
    }
  }
  if (parts.length === 0) {
    throw new UserFacingError(skipped.length ? "Nenhum arquivo pôde ser lido." : "Nenhum arquivo enviado ainda.");
  }

  const merged = mergeTables(importer, parts);
  const dir = path.join(storage.workRoot, "_fiscal", randomUUID());
  await mkdir(dir, { recursive: true });
  const tables: TableReport[] = [];
  try {
    for (const table of template.tables) {
      const file = path.join(dir, `${table.name}.csv`);
      let rows = merged[table.name] ?? [];
      // The ingest refuses empty files; a dimension nobody references (e.g. NFC-e without recipients) gets one placeholder row.
      if (rows.length === 0 && table.kind === "dimension") rows = [placeholderRow(table)];
      await writeFile(file, toCsv(table.columns.map((c) => c.name), rows), "utf8");
      tables.push(await ingestIntoDraft(access, table, file, `${table.name}.csv`));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { ok: tables.every((t) => t.ok), files: parts.length, skipped, tables };
}
