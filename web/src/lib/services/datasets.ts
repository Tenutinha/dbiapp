import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { InstanceAccess } from "../access";
import {
  checkRelationships, ingestTable, inspectParts, type OrphanReport, type SourceFormat, type TableReport,
} from "../ingest/ingest";
import { joinedName } from "../ingest/joined-name";
import { getDraft, getOrCreateDraft, listFiles, promoteDraft, registerDraftFile, type VersionRef } from "../data/repository";
import { storage } from "../storage";
import { isDatasetKey, isIssuedUploadKey } from "../storage-keys";
import { joinParts, splitParts } from "../storage-parts";
import { getTemplate } from "../templates/registry";
import { extraFacts, type Template, type TemplateTable } from "../templates/schema";

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2 GB
const PARQUET_MIME = "application/vnd.apache.parquet";

export class UserFacingError extends Error {}

export async function requireTemplate(templateId: string): Promise<Template> {
  const template = await getTemplate(templateId);
  if (!template) throw new UserFacingError(`Template "${templateId}" não está mais disponível.`);
  return template;
}

export function detectFormat(fileName: string): SourceFormat {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".parquet") return "parquet";
  if (ext === ".csv" || ext === ".txt") return "csv";
  throw new UserFacingError("Formato não suportado. Envie .parquet ou .csv.");
}

async function requireTable(access: InstanceAccess, tableName: string): Promise<TemplateTable> {
  const template = await requireTemplate(access.templateId);
  const table = template.tables.find((t) => t.name === tableName);
  if (!table) throw new UserFacingError(`Tabela "${tableName}" não faz parte deste dashboard.`);
  return table;
}

export function checkSize(size: number): void {
  if (size <= 0) throw new UserFacingError("Arquivo vazio.");
  if (size > MAX_UPLOAD_BYTES) throw new UserFacingError("Arquivo maior que 2 GB.");
}

/**
 * Validates the raw file at `incomingPath` against the contract, stores the converted Parquet
 * and registers it in the draft. Shared by the direct and the signed-URL upload paths.
 */
export async function ingestIntoDraft(
  access: InstanceAccess, table: TemplateTable, incomingPath: string, originalName: string,
): Promise<TableReport> {
  const format = detectFormat(originalName);
  const draft = await getOrCreateDraft(access.instanceId);
  // Unique per upload: concurrent uploads never share a file, and published files are never overwritten.
  const key = storage.datasetKey(access.org.slug, access.client?.slug ?? null, access.instanceId, access.templateId, draft.version, table.name);
  const targetPath = storage.pathFor(key);

  const report = await ingestTable({ storageRoot: storage.workRoot, table, sourcePath: incomingPath, format, targetPath });
  if (!report.ok) return report;

  try {
    await storage.commit(key, PARQUET_MIME);
  } catch (err) {
    console.error("[datasets] could not store converted file", err);
    await storage.remove([key]);
    return { ...report, ok: false, rowCount: 0, sizeBytes: 0, errors: ["Não foi possível guardar o arquivo. Tente novamente."] };
  }

  const registered = await registerDraftFile(access.instanceId, draft.id, {
    tableName: table.name,
    storagePath: key,
    rowCount: report.rowCount,
    sizeBytes: report.sizeBytes,
    originalName: originalName.slice(0, 255),
  });
  if (!registered.ok) {
    await storage.remove([key]);
    return {
      ...report, ok: false, rowCount: 0, sizeBytes: 0,
      errors: ["Uma nova versão foi publicada durante o envio. Envie o arquivo novamente."],
    };
  }
  await removeReplaced(access, draft, registered.replacedPath);
  return report;
}

/**
 * Drops the file(s) a table had in this draft before the new ones. Only files written into this same
 * draft go (what came from a published version is only carried over at publish time, and stays).
 */
async function removeReplaced(access: InstanceAccess, draft: VersionRef, replaced: string | null): Promise<void> {
  if (!replaced) return;
  const draftFolder = `orgs/${access.org.slug}/datasets/${access.instanceId}/v${draft.version}/`;
  const olderDraftFolder = `datasets/${access.org.id}/${access.instanceId}/v${draft.version}/`;
  const legacyDraftDir = `${path.sep}v${draft.version}${path.sep}`;
  const ofThisDraft = splitParts(replaced).filter(
    (p) => p.startsWith(draftFolder) || p.startsWith(olderDraftFolder) || (path.isAbsolute(p) && p.includes(legacyDraftDir)),
  );
  if (ofThisDraft.length > 0) await storage.remove(ofThisDraft);
}

// ---------- a table fed by several files: one converted Parquet per file, read together ----------

/** A source file converted for a table of the draft: where the Parquet is, and the file's name. */
export interface DraftPart {
  key: string;
  name: string;
}

const NEW_VERSION = "Uma nova versão foi publicada durante o envio. Engate de novo.";

/**
 * Converts one raw file to the contract, as one of the parts of a table of the draft. Same validation as
 * a table of a single file; the part only counts once `registerParts` makes the table out of it.
 */
export async function convertToPart(
  access: InstanceAccess, table: TemplateTable, incomingPath: string, originalName: string,
): Promise<TableReport & { key?: string }> {
  const format = detectFormat(originalName);
  const draft = await getOrCreateDraft(access.instanceId);
  const key = storage.datasetKey(access.org.slug, access.client?.slug ?? null, access.instanceId, access.templateId, draft.version, table.name);
  const report = await ingestTable({
    storageRoot: storage.workRoot, table, sourcePath: incomingPath, format, targetPath: storage.pathFor(key),
  });
  if (!report.ok) return report;
  try {
    await storage.commit(key, PARQUET_MIME);
  } catch (err) {
    console.error("[datasets] could not store converted part", err);
    await storage.remove([key]);
    return { ...report, ok: false, rowCount: 0, sizeBytes: 0, errors: ["Não foi possível guardar o arquivo. Tente novamente."] };
  }
  return { ...report, key };
}

/** Parts that are not the table's registered files in the draft (those must never be dropped as leftovers). */
async function unregistered(draftId: string, keys: readonly string[]): Promise<string[]> {
  const inUse = new Set((await listFiles(draftId)).flatMap((f) => splitParts(f.storagePath)));
  return keys.filter((k) => !inUse.has(k));
}

/**
 * Makes a table of the draft out of the converted parts: the table becomes exactly those files, read
 * together (nothing is rewritten). Refused, and the parts dropped, when they do not go together — a
 * dimension key that is in two files.
 */
export async function registerParts(access: InstanceAccess, table: TemplateTable, parts: readonly DraftPart[]): Promise<TableReport> {
  const failed = (errors: string[], files?: TableReport["files"]): TableReport => ({
    table: table.name, ok: false, rowCount: 0, sizeBytes: 0, errors, warnings: [], files,
  });
  const draft = await getDraft(access.instanceId);
  const keys = parts.map((p) => p.key);
  const mine = draft !== null && keys.every((k) => isDatasetKey(k, access.org.slug, access.client?.slug ?? null, access.instanceId, access.templateId, draft.version, table.name));
  if (!draft || !mine || new Set(keys).size !== keys.length) return failed([NEW_VERSION]);

  let local: { name: string; path: string }[];
  try {
    local = await Promise.all(parts.map(async (p) => ({ name: p.name, path: await storage.localPath(p.key) })));
  } catch {
    await storage.remove(await unregistered(draft.id, keys));
    return failed(["Um dos arquivos convertidos não está mais disponível. Engate de novo."]);
  }
  const inspected = await inspectParts(storage.workRoot, table, local);
  if (inspected.errors.length > 0) {
    await storage.remove(await unregistered(draft.id, keys));
    return failed(inspected.errors, inspected.files);
  }

  const sizes = await Promise.all(local.map((p) => stat(p.path).then((s) => s.size)));
  const report: TableReport = {
    table: table.name, ok: true, rowCount: inspected.rowCount, sizeBytes: sizes.reduce((a, b) => a + b, 0),
    errors: [], warnings: [], files: inspected.files,
  };
  const registered = await registerDraftFile(access.instanceId, draft.id, {
    tableName: table.name,
    storagePath: joinParts(keys),
    rowCount: report.rowCount,
    sizeBytes: report.sizeBytes,
    originalName: joinedName(parts.map((p) => p.name)),
  });
  if (!registered.ok) {
    await storage.remove(keys);
    return failed([NEW_VERSION]);
  }
  const kept = new Set(keys);
  await removeReplaced(access, draft, joinParts(splitParts(registered.replacedPath ?? "").filter((p) => !kept.has(p))) || null);
  return report;
}

/** Drops converted parts that will not become a table (a later file of the list was refused). */
export async function discardParts(access: InstanceAccess, table: TemplateTable, keys: readonly string[]): Promise<void> {
  const draft = await getDraft(access.instanceId);
  if (!draft) return;
  const mine = keys.filter((k) => isDatasetKey(k, access.org.slug, access.client?.slug ?? null, access.instanceId, access.templateId, draft.version, table.name));
  await storage.remove(await unregistered(draft.id, mine));
}

// ---------- direct upload (local storage: the file comes in the request body) ----------

async function saveStream(file: File, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(file.stream() as unknown as NodeReadableStream), createWriteStream(target));
}

export async function uploadTable(access: InstanceAccess, tableName: string, file: File): Promise<TableReport> {
  const table = await requireTable(access, tableName);
  checkSize(file.size);
  const ext = detectFormat(file.name);
  const incomingKey = storage.uploadKey(access.org.slug, access.instanceId, ext);
  try {
    await saveStream(file, storage.pathFor(incomingKey));
    return await ingestIntoDraft(access, table, storage.pathFor(incomingKey), file.name);
  } finally {
    await storage.remove([incomingKey]);
  }
}

// ---------- signed upload (Supabase: the browser sends the file straight to Storage) ----------

export type UploadPlan = { mode: "direct" } | { mode: "signed"; key: string; signedUrl: string };

export async function planUpload(access: InstanceAccess, tableName: string, fileName: string, size: number): Promise<UploadPlan> {
  await requireTable(access, tableName);
  checkSize(size);
  const target = await storage.createUploadTarget(storage.uploadKey(access.org.slug, access.instanceId, detectFormat(fileName)));
  return target ? { mode: "signed", key: target.key, signedUrl: target.signedUrl } : { mode: "direct" };
}

export async function ingestUploaded(
  access: InstanceAccess, tableName: string, key: string, fileName: string,
): Promise<TableReport> {
  const table = await requireTable(access, tableName);
  // The key must be one we issued for this dashboard.
  if (!isIssuedUploadKey(key, access.org.slug, access.instanceId)) {
    throw new UserFacingError("Envio inválido. Tente novamente.");
  }
  try {
    const local = await storage.localPath(key).catch(() => {
      throw new UserFacingError("Arquivo não encontrado no armazenamento. Envie de novo.");
    });
    return await ingestIntoDraft(access, table, local, fileName);
  } finally {
    await storage.remove([key]);
  }
}

// ---------- publish ----------

export interface PublishResult {
  ok: boolean;
  errors: string[];
  orphans: OrphanReport[];
}

/** Local paths (downloading from Storage when needed) for a table → key map. */
export async function resolveLocalFiles(keys: Readonly<Record<string, string>>): Promise<Record<string, string>> {
  // A table fed by several files has one key per part, and so one local path per part (see storage-parts.ts).
  const entries = await Promise.all(Object.entries(keys).map(async ([t, k]) =>
    [t, joinParts(await Promise.all(splitParts(k).map((part) => storage.localPath(part))))] as const));
  return Object.fromEntries(entries);
}

/**
 * Promotes the draft to active once every table is present.
 * Tables not re-uploaded in this draft are carried over from the active version.
 */
export async function publishDraft(access: InstanceAccess): Promise<PublishResult> {
  const template = await requireTemplate(access.templateId);
  const draft = await getDraft(access.instanceId);
  if (!draft) return { ok: false, errors: ["Nenhum arquivo novo para publicar."], orphans: [] };

  const [draftFiles, activeFiles] = await Promise.all([
    listFiles(draft.id),
    access.activeVersionId ? listFiles(access.activeVersionId) : Promise.resolve([]),
  ]);
  // Draft files win over the active version's.
  const files: Record<string, string> = {};
  for (const f of [...activeFiles, ...draftFiles]) files[f.tableName] = f.storagePath;

  // Extra facts (e.g. one block of every period) may come later: the dashboard is published without them.
  const optional = new Set(extraFacts(template).map((t) => t.name));
  const required = template.tables.filter((t) => !optional.has(t.name)).map((t) => t.name);
  const missing = required.filter((t) => !files[t]);
  if (missing.length > 0) {
    return { ok: false, errors: [`Faltam tabelas: ${missing.join(", ")}.`], orphans: [] };
  }

  const orphans = await checkRelationships(storage.workRoot, template.relationships, await resolveLocalFiles(files));
  const result = await promoteDraft(access.instanceId, draft.id, required, files, {
    orphans, publishedBy: access.user.id,
  });
  if (!result.ok) {
    const error =
      result.reason === "missing_tables"
        ? `Faltam tabelas: ${(result.tables ?? []).join(", ")}.`
        : "Os arquivos mudaram enquanto publicávamos. Confira e publique de novo.";
    return { ok: false, errors: [error], orphans: [] };
  }
  // Only the published version stays in the dashboard's folder: the files it replaced go away.
  if (result.superseded.length > 0) {
    await storage.remove(result.superseded).catch((err: unknown) =>
      console.error(`[datasets] ${result.superseded.length} file(s) of the previous version of ${access.instanceId} were not deleted`, err),
    );
  }
  return { ok: true, errors: [], orphans };
}
