import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { InstanceAccess } from "../access";
import { checkRelationships, ingestTable, type OrphanReport, type SourceFormat, type TableReport } from "../ingest/ingest";
import { getDraft, getOrCreateDraft, listFiles, promoteDraft, registerDraftFile } from "../data/repository";
import { storage } from "../storage";
import { getTemplate } from "../templates/registry";
import type { Template } from "../templates/schema";

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2 GB

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

async function saveIncoming(file: File, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const body = Readable.fromWeb(file.stream() as unknown as NodeReadableStream);
  await pipeline(body, createWriteStream(target));
}

/** Validates and stores one table of the instance's draft dataset. */
export async function uploadTable(access: InstanceAccess, tableName: string, file: File): Promise<TableReport> {
  const template = await requireTemplate(access.templateId);
  const table = template.tables.find((t) => t.name === tableName);
  if (!table) throw new UserFacingError(`Tabela "${tableName}" não faz parte deste dashboard.`);
  if (file.size === 0) throw new UserFacingError("Arquivo vazio.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserFacingError("Arquivo maior que 2 GB.");

  const format = detectFormat(file.name);
  const draft = await getOrCreateDraft(access.instanceId);
  const versionDir = storage.versionDir(access.org.id, access.instanceId, draft.version);
  // Unique per upload: concurrent uploads never share a file, and published files are never overwritten.
  const targetPath = path.join(versionDir, `${table.name}.${randomUUID().slice(0, 8)}.parquet`);
  const incoming = storage.incomingFile(format);

  try {
    await saveIncoming(file, incoming);
    const report = await ingestTable({ storageRoot: storage.root, table, sourcePath: incoming, format, targetPath });
    if (!report.ok) return report;

    const registered = await registerDraftFile(access.instanceId, draft.id, {
      tableName: table.name,
      storagePath: targetPath,
      rowCount: report.rowCount,
      sizeBytes: report.sizeBytes,
      originalName: file.name.slice(0, 255),
    });
    if (!registered.ok) {
      await rm(targetPath, { force: true });
      return {
        ...report, ok: false, rowCount: 0, sizeBytes: 0,
        errors: ["Uma nova versão foi publicada durante o envio. Envie o arquivo novamente."],
      };
    }
    if (registered.replacedPath?.startsWith(versionDir)) await rm(registered.replacedPath, { force: true });
    return report;
  } finally {
    await rm(incoming, { force: true });
  }
}

export interface PublishResult {
  ok: boolean;
  errors: string[];
  orphans: OrphanReport[];
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

  const orphans = await checkRelationships(storage.root, template.relationships, files);
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
