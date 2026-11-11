/**
 * Raw fiscal files (SPED .txt, NF-e .xml) of dashboards built on the fiscal templates.
 *
 *   1. upload  — the file goes to the bucket like any upload (signed URL, or the request body locally);
 *   2. store   — it is identified (company, period, document) and kept, organized, under
 *                orgs/<org>/clientes/<cliente>/fiscal/<molde>/<cnpj>/<aaaa-mm>/ (or orgs/<org>/fiscal/… for
 *                the organization's own dashboards); a newer copy of the same document
 *                (the month's SPED, an NF-e key) replaces the old one;
 *   3. rebuild — every stored file is read again into the template's tables, which enter the draft
 *                through the regular ingest (same validation as a table upload). Publishing stays manual.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../access";
import { csvLine, toCsv } from "../fiscal/csv";
import {
  checkExtension, fiscalImporterFor, KeyedTables, mergeTables, SPED_DIMENSION_KEYS, SPED_HEAD_BYTES,
  type FiscalIdentity, type FiscalImporter, type FiscalTables,
} from "../fiscal/importers";
import { FiscalFileError, type Row } from "../fiscal/sped";
import { factColumns } from "../fiscal/sped-kinds";
import { appendSpedFile, writeChunk } from "../fiscal/sped-stream";
import type { TableReport } from "../ingest/ingest";
import { extraFacts, mainFact, type Template, type TemplateTable } from "../templates/schema";
import { storage } from "../storage";
import { relativeToOrg } from "../storage-browse";
import { fiscalDocumentId, fiscalFileKey, fiscalFolder, isIssuedFiscalUploadKey, spaceFolder } from "../storage-keys";
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

/** The dashboard's folder of raw files, inside its space's folder (the client's, or the organization's). */
function folderOf(access: InstanceAccess): string {
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
  // Companies, then their periods, then each period's files: each level in parallel (one listing at a
  // time took ~0.2 s per folder, seconds for a year of periods).
  const companies = await storage.listOrgFolder(access.org.slug, base);
  const periods = (await Promise.all(
    companies.folders.map(async (cnpj) =>
      (await storage.listOrgFolder(access.org.slug, `${base}/${cnpj}`)).folders.map((periodo) => ({ cnpj, periodo }))),
  )).flat();
  const listed = await Promise.all(
    periods.map(async (period) => ({
      period,
      files: (await storage.listOrgFolder(access.org.slug, `${base}/${period.cnpj}/${period.periodo}`, MAX_FILES_PER_FOLDER)).files,
    })),
  );
  return listed
    .filter((l) => l.files.length > 0)
    .map(({ period, files }) => ({ period, keys: files.map((f) => ({ key: f.key, name: f.name, sizeBytes: f.sizeBytes })) }));
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

/**
 * Files one raw fiscal file in its standard place: <folder><cnpj>/<período>/<documento>.<rand>.<ext>
 * (`folder` = fiscalFolder of its space and template), replacing an older copy of the same document.
 * Shared by the importer ("Montar tabelas") and the file explorer ("Organizar pasta").
 */
export async function fileFiscal(
  orgSlug: string, folder: string, key: string, fileName: string, id: FiscalIdentity,
): Promise<{ key: string; replaced: number; replacedKeys: string[] }> {
  const ext = fileName.toLowerCase().endsWith(".xml") ? "xml" : "txt";
  const periodFolder = relativeToOrg(orgSlug, `${folder}${id.cnpj}/${id.periodo}`);
  const existing = await storage.listOrgFolder(orgSlug, periodFolder, MAX_FILES_PER_FOLDER);
  const older = existing.files.filter((f) => fiscalDocumentId(f.name) === id.documentId && f.key !== key).map((f) => f.key);
  const to = fiscalFileKey(folder, id.cnpj, id.periodo, id.documentId, ext);
  await storage.move(key, to);
  await storage.remove(older);
  return { key: to, replaced: older.length, replacedKeys: older };
}

export interface RebuildResult {
  ok: boolean;
  files: number;
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

interface Gathered {
  files: number;
  skipped: RebuildResult["skipped"];
  /** Tables kept in memory (dimensions; and the facts of document importers). */
  tables: FiscalTables;
  /** Fact CSV already on disk (SPED), by table name. */
  written: Record<string, string>;
}

export interface RebuildOptions {
  /**
   * "blocks": only the block facts (e.g. bloco A of every period) and the dimensions are rebuilt; the main
   * fact stays as published. For when the whole file of every period is too much to hold.
   */
  only?: "blocks";
}

/** Reads every stored file: SPED facts go straight to a CSV on disk, the rest is gathered in memory. */
async function gather(
  access: InstanceAccess, importer: FiscalImporter, template: Template, dir: string, options: RebuildOptions,
): Promise<Gathered> {
  const stored = (await walk(access)).flatMap((f) => f.keys);
  const total = stored.reduce((s, f) => s + f.sizeBytes, 0);
  if (process.env.VERCEL && total > MAX_HOSTED_REBUILD_BYTES) {
    throw new UserFacingError(
      `Os arquivos guardados somam ${Math.round(total / 1024 ** 2)} MB, mais do que dá para montar por aqui. Peça à equipe da DBI para processar este volume.`,
    );
  }
  const skipped: RebuildResult["skipped"] = [];
  const written: Record<string, string> = {};
  let files = 0;
  const skip = (key: string, err: unknown): void => {
    if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not read", key, err);
    skipped.push({ path: relativeToOrg(access.org.slug, key), error: err instanceof FiscalFileError ? err.message : "não foi possível ler o arquivo" });
  };

  if (importer.mode === "documents") {
    const parts: FiscalTables[] = [];
    for (const f of stored) {
      try {
        parts.push(importer.parse(await storage.read(f.key)));
        files += 1;
      } catch (err) {
        skip(f.key, err);
      }
    }
    return { files, skipped, tables: mergeTables(importer, parts), written };
  }

  const fact = mainFact(template);
  // Block facts the template has (a kind may declare one the template does not use).
  const blockTables = extraFacts(template).map((t) => t.name).filter((name) => name in importer.kind.blockFacts);
  if (options.only === "blocks" && blockTables.length === 0) {
    throw new UserFacingError("Este dashboard não tem tabelas por bloco.");
  }
  const csvOf = (table: string): string => path.join(dir, `${table}.csv`);
  const open = (table: string): WriteStream => createWriteStream(csvOf(table), { encoding: "utf8" });
  const factOut = options.only === "blocks" ? null : open(fact.name);
  const blockOuts = Object.fromEntries(blockTables.map((table) => [table, open(table)]));
  const outs = [...(factOut ? [factOut] : []), ...Object.values(blockOuts)];
  const blockLines: Record<string, number> = Object.fromEntries(blockTables.map((table) => [table, 0]));
  // A hundred monthly files repeat the same participants and items: they are merged as the files are read.
  const dimensions = new KeyedTables(SPED_DIMENSION_KEYS);
  try {
    for (const out of outs) await writeChunk(out, csvLine(factColumns(importer.kind)));
    for (const f of stored) {
      try {
        const local = await storage.localPath(f.key);
        try {
          const read = await appendSpedFile(importer.kind, local, { fact: factOut, blocks: blockOuts });
          dimensions.add(read.dimensions);
          for (const table of blockTables) blockLines[table] += read.blockLines[table] ?? 0;
          files += 1;
        } finally {
          // The cached copy of a remote object is only needed while it is read.
          if (storage.remote()) await rm(local, { force: true }).catch(() => undefined);
        }
      } catch (err) {
        skip(f.key, err);
      }
    }
  } finally {
    for (const out of outs) out.end();
    await Promise.all(outs.map((out) => once(out, "close")));
  }
  if (factOut) written[fact.name] = csvOf(fact.name);
  // A block the files do not bring (a company without services) leaves its fact out: the ingest refuses empty tables.
  for (const table of blockTables) if (blockLines[table] > 0) written[table] = csvOf(table);
  return { files, skipped, tables: dimensions.tables(), written };
}

/** Files what was uploaded loose, reads every stored file into the template's tables and puts them in the draft. */
export async function rebuildFiscal(access: InstanceAccess, options: RebuildOptions = {}): Promise<RebuildResult> {
  const importer = requireImporter(access);
  const template = await requireTemplate(access.templateId);
  const adopted = await adoptLooseFiles(access);
  const dir = path.join(storage.workRoot, "_fiscal", randomUUID());
  await mkdir(dir, { recursive: true });
  const tables: TableReport[] = [];
  try {
    const gathered = await gather(access, importer, template, dir, options);
    if (gathered.files === 0) {
      throw new UserFacingError(gathered.skipped.length ? "Nenhum arquivo pôde ser lido." : "Nenhum arquivo enviado ainda.");
    }
    for (const table of template.tables) {
      let file = gathered.written[table.name];
      // A fact that was not written this time (the main one in a blocks-only rebuild, a block the files
      // do not bring) keeps what is published.
      if (!file && table.kind === "fact" && importer.mode === "sped") continue;
      if (!file) {
        file = path.join(dir, `${table.name}.csv`);
        let rows = gathered.tables[table.name] ?? [];
        // The ingest refuses empty files; a dimension nobody references (e.g. NFC-e without recipients) gets one placeholder row.
        if (rows.length === 0 && table.kind === "dimension") rows = [placeholderRow(table)];
        await writeFile(file, toCsv(table.columns.map((c) => c.name), rows), "utf8");
      }
      tables.push(await ingestIntoDraft(access, table, file, `${table.name}.csv`));
    }
    return { ok: tables.every((t) => t.ok), files: gathered.files, adopted, skipped: gathered.skipped, tables };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

