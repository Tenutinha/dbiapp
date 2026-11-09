import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { InstanceAccess } from "../access";
import { checkRelationships, ingestTable, type OrphanReport, type SourceFormat, type TableReport } from "../ingest/ingest";
import { getDraft, getOrCreateDraft, listFiles, promoteDraft, registerDraftFile } from "../data/repository";
import { storage } from "../storage";
import { isIssuedUploadKey } from "../storage-keys";
import { getTemplate } from "../templates/registry";
import type { Template, TemplateTable } from "../templates/schema";

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2 GB
const PARQUET_MIME = "application/vnd.apache.parquet";

export class UserFacingError extends Error {}

export async function requireTemplate(templateId: string): Promise<Template> {
  const template = await getTemplate(templateId);
  if (!template) throw new UserFacingError(`Template "${templateId}" não está mais disponível.`);
  return template;
}

function detectFormat(fileName: string): SourceFormat {
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
  const key = storage.datasetKey(access.org.slug, access.instanceId, draft.version, table.name);
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
  // Only files uploaded into this same draft can be replaced (carry-overs happen at publish time).
  const draftPrefix = `datasets/${access.org.id}/${access.instanceId}/v${draft.version}/`;
  const legacyDraftDir = `${path.sep}v${draft.version}${path.sep}`;
  const replaced = registered.replacedPath;
  if (replaced && (replaced.startsWith(draftPrefix) || (path.isAbsolute(replaced) && replaced.includes(legacyDraftDir)))) {
    await storage.remove([replaced]);
  }
  return report;
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
  const entries = await Promise.all(Object.entries(keys).map(async ([t, k]) => [t, await storage.localPath(k)] as const));
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

  const required = template.tables.map((t) => t.name);
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
  return { ok: true, errors: [], orphans };
}
