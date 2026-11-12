/**
 * "Montar tabelas" for the SPED dashboards, one raw file at a time (see fiscal/parts-plan.ts):
 *
 *   1. each stored raw file (company + period) is read once into its own parts — one Parquet per table,
 *      in <dashboard>/partes/<cnpj>/<aaaa-mm>/<id>/ — and a marker is written last;
 *   2. files already read (same content, same reader) are skipped; parts of replaced or deleted files go;
 *   3. each table of the draft is put together from the parts: the facts from the files they keep (all
 *      periods, or the latest for a main fact that holds the whole file), the dimensions from the ones
 *      already in the dashboard plus what the newly read files brought (the latest period wins).
 *
 * Adding a month reads only that month; a retificadora reads only its month again.
 */
import "server-only";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../access";
import { getDraft, listFiles } from "../data/repository";
import { quotePath, readParquet, withConnection } from "../duck/engine";
import { csvLine, toCsv } from "../fiscal/csv";
import type { FiscalTables, SpedImporter } from "../fiscal/importers";
import { dimensionHow, factHow, sourcesOf, type Lineage, type TableLineage } from "../fiscal/lineage";
import {
  filesForFact, parseMarker, partsFolderId, planParts, type PartsFolder, type PartsMarker, type RawFile,
} from "../fiscal/parts-plan";
import { FiscalFileError, type Row } from "../fiscal/sped";
import { factColumns, SPED_READER_VERSION } from "../fiscal/sped-kinds";
import { appendSpedFile, writeChunk } from "../fiscal/sped-stream";
import { ingestTable, type TableReport } from "../ingest/ingest";
import { storage } from "../storage";
import { relativeToOrg } from "../storage-browse";
import { splitParts } from "../storage-parts";
import { dashboardFolder, fiscalPartsFolder } from "../storage-keys";
import { extraFacts, mainFact, sortColumns, type Template, type TemplateTable } from "../templates/schema";
import { ingestIntoDraft, UserFacingError } from "./datasets";

const PARQUET_MIME = "application/vnd.apache.parquet";
const JSON_MIME = "application/json";
const MARKER = "pronto.json";
const LINEAGE = "linhagem.json";
/** Raw bytes one serverless request can read (disk and time are limited there); files already read do not count. */
const MAX_HOSTED_READ_BYTES = 250 * 1024 ** 2;

export interface PartsRebuildResult {
  ok: boolean;
  /** Where each table's lines came from (also written as linhagem.json next to the draft's tables). */
  lineage: Lineage | null;
  /** Files whose tables are in the draft (read now or reused). */
  files: number;
  /** Read now (new, replaced, or read by an older reader). */
  read: number;
  /** Already read before, reused as they were. */
  reused: number;
  skipped: { path: string; error: string }[];
  tables: TableReport[];
}

export interface PartsOptions {
  /** Keeps the main fact as published (only the block facts and the dimensions are put together). */
  only?: "blocks";
  /** Reads every file again, even the ones already read. */
  rereadAll?: boolean;
}

/** The facts this kind of SPED writes for the template: its main fact and the block facts it declares. */
function spedFacts(importer: SpedImporter, template: Template): TemplateTable[] {
  return [mainFact(template), ...extraFacts(template).filter((t) => t.name in importer.kind.blockFacts)];
}

/** A table as stored (a block fact that sums lines on the way in is already summed in its parts). */
const stored = (table: TemplateTable): TemplateTable => ({ ...table, source: undefined });

async function listPartsFolders(access: InstanceAccess, root: string): Promise<PartsFolder[]> {
  const base = relativeToOrg(access.org.slug, root).replace(/\/$/, "");
  const companies = (await storage.listOrgFolder(access.org.slug, base)).folders;
  const places = (await Promise.all(companies.map(async (cnpj) =>
    (await storage.listOrgFolder(access.org.slug, `${base}/${cnpj}`)).folders.map((periodo) => ({ cnpj, periodo }))))).flat();
  const ids = (await Promise.all(places.map(async (p) =>
    (await storage.listOrgFolder(access.org.slug, `${base}/${p.cnpj}/${p.periodo}`)).folders.map((id) => ({ ...p, id }))))).flat();
  return Promise.all(ids.map(async (f) => {
    try {
      const bytes = await storage.read(`${root}${f.cnpj}/${f.periodo}/${f.id}/${MARKER}`);
      return { ...f, marker: parseMarker(JSON.parse(new TextDecoder().decode(bytes))) };
    } catch {
      return { ...f, marker: null };
    }
  }));
}

/** Writes one CSV per table for one raw file; returns the files written, the lines of each and the dimensions. */
async function readIntoCsv(
  importer: SpedImporter, facts: readonly TemplateTable[], local: string, dir: string,
): Promise<{ csv: Record<string, string>; lines: Record<string, number>; dimensions: FiscalTables }> {
  const [main, ...blocks] = facts;
  const csv = Object.fromEntries(facts.map((t) => [t.name, path.join(dir, `${t.name}.csv`)]));
  const outs: Record<string, WriteStream> = Object.fromEntries(facts.map((t) => [t.name, createWriteStream(csv[t.name], { encoding: "utf8" })]));
  try {
    for (const out of Object.values(outs)) await writeChunk(out, csvLine(factColumns(importer.kind)));
    const read = await appendSpedFile(importer.kind, local, {
      fact: outs[main.name], blocks: Object.fromEntries(blocks.map((t) => [t.name, outs[t.name]])),
    });
    return { csv, lines: { [main.name]: read.lines, ...read.blockLines }, dimensions: read.dimensions };
  } finally {
    for (const out of Object.values(outs)) out.end();
    await Promise.all(Object.values(outs).map((out) => once(out, "close")));
  }
}

/** Converts a CSV to the table's contract and keeps it at `key`. */
async function keepPart(table: TemplateTable, source: string, key: string): Promise<number> {
  const report = await ingestTable({ storageRoot: storage.workRoot, table, sourcePath: source, format: "csv", targetPath: storage.pathFor(key) });
  if (!report.ok) throw new Error(`${table.name}: ${report.errors.join(" ")}`);
  await storage.commit(key, PARQUET_MIME);
  return report.rowCount;
}

/** Reads one raw file into its parts folder; the marker goes last, so a folder without it is incomplete. */
async function readFile(
  importer: SpedImporter, template: Template, facts: readonly TemplateTable[], file: RawFile, folder: string, dir: string,
): Promise<PartsMarker> {
  const local = await storage.localPath(file.key);
  try {
    const { csv, lines, dimensions } = await readIntoCsv(importer, facts, local, dir);
    const marker: PartsMarker = {
      reader: SPED_READER_VERSION,
      source: { key: file.key, sizeBytes: file.sizeBytes, updatedAt: file.updatedAt },
      tables: {},
      dimensions: {},
    };
    for (const table of facts) {
      // The header line alone: the file brings nothing for this table (the ingest refuses empty files).
      if ((lines[table.name] ?? 0) === 0) {
        marker.tables[table.name] = { key: null, rows: 0 };
        continue;
      }
      const key = `${folder}${table.name}.parquet`;
      marker.tables[table.name] = { key, rows: await keepPart(table, csv[table.name], key) };
    }
    for (const table of template.tables.filter((t) => t.kind === "dimension")) {
      const rows = dimensions[table.name] ?? [];
      if (rows.length === 0) {
        marker.dimensions[table.name] = { key: null, rows: 0 };
        continue;
      }
      const source = path.join(dir, `${table.name}.csv`);
      await writeFile(source, toCsv(table.columns.map((c) => c.name), rows), "utf8");
      const key = `${folder}${table.name}.parquet`;
      marker.dimensions[table.name] = { key, rows: await keepPart(table, source, key) };
    }
    await storage.putBytes(`${folder}${MARKER}`, new TextEncoder().encode(JSON.stringify(marker)), JSON_MIME);
    return marker;
  } finally {
    // The cached copy of a remote object is only needed while it is read.
    if (storage.remote()) await rm(local, { force: true }).catch(() => undefined);
  }
}

/** One row a dimension nobody references gets (the ingest refuses empty tables). */
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

/**
 * Puts one table of the draft together from Parquet sources (parts, or what the dashboard already has),
 * through the regular ingest. `latestWins`: a dimension keeps one line per key, the one of the last source.
 */
async function assemble(
  access: InstanceAccess, table: TemplateTable, sources: readonly string[], dir: string, latestWins: boolean,
): Promise<TableReport> {
  const local = await Promise.all(sources.flatMap(splitParts).map((k) => storage.localPath(k)));
  const target = path.join(dir, `${table.name}.parquet`);
  const columns = table.columns.map((c) => c.name).join(", ");
  await withConnection(storage.workRoot, async (conn) => {
    const union = local.map((file, i) => `SELECT ${columns}, ${i} AS __ordem FROM ${readParquet(file)}`).join(" UNION ALL ");
    const order = sortColumns(table);
    const body = latestWins && table.key
      ? `SELECT ${columns} FROM (${union}) QUALIFY row_number() OVER (PARTITION BY ${table.key} ORDER BY __ordem DESC) = 1`
      : `SELECT ${columns} FROM (${union})${order.length > 0 ? ` ORDER BY ${order.join(", ")}` : ""}`;
    await conn.run(`COPY (${body}) TO ${quotePath(target)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880)`);
  });
  return ingestIntoDraft(access, stored(table), target, `${table.name}.parquet`);
}

/** What the dashboard already has for a table: the draft's file, else the published one. */
async function currentFile(access: InstanceAccess, table: string): Promise<string | null> {
  for (const versionId of [(await getDraft(access.instanceId))?.id, access.activeVersionId]) {
    if (!versionId) continue;
    const file = (await listFiles(versionId)).find((f) => f.tableName === table);
    if (file) return file.storagePath;
  }
  return null;
}

/** Writes the lineage next to the draft's tables (<dashboard>/v<n>/linhagem.json); never fails the build. */
async function keepLineage(access: InstanceAccess, lineage: Lineage): Promise<void> {
  try {
    const draft = await getDraft(access.instanceId);
    if (!draft) return;
    const folder = dashboardFolder(access.org.slug, access.client?.slug || null, access.instanceId, access.templateId);
    await storage.putBytes(`${folder}v${draft.version}/${LINEAGE}`, new TextEncoder().encode(JSON.stringify(lineage, null, 2)), JSON_MIME);
  } catch (err) {
    console.error("[fiscal] could not keep the lineage", access.instanceId, err);
  }
}

/** "Montar tabelas" for a SPED dashboard, reading only the files that are new or changed. */
export async function rebuildSpedFromParts(
  access: InstanceAccess, importer: SpedImporter, template: Template, files: readonly RawFile[], options: PartsOptions = {},
): Promise<PartsRebuildResult> {
  const root = fiscalPartsFolder(access.org.slug, access.client?.slug || null, access.instanceId, access.templateId);
  const facts = spedFacts(importer, template);
  let folders = await listPartsFolders(access, root);
  if (options.rereadAll) {
    // Reading everything again starts from no parts at all (a file would land in the folder it had).
    for (const f of folders) await storage.removeFolder(`${root}${f.cnpj}/${f.periodo}/${f.id}/`);
    folders = [];
  }
  const plan = planParts(files, folders, facts.map((t) => t.name), SPED_READER_VERSION);

  const bytes = plan.read.reduce((s, f) => s + f.sizeBytes, 0);
  if (process.env.VERCEL && bytes > MAX_HOSTED_READ_BYTES) {
    throw new UserFacingError(
      `Há ${plan.read.length} arquivo(s) novo(s) ou alterado(s) somando ${Math.round(bytes / 1024 ** 2)} MB, mais do que dá para ler por aqui. Peça à equipe da DBI para processar este volume.`,
    );
  }

  const work = path.join(storage.workRoot, "_fiscal", `${access.instanceId}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const skipped: PartsRebuildResult["skipped"] = [];
  const justRead: { file: RawFile; marker: PartsMarker }[] = [];
  try {
    for (const file of plan.read) {
      const folder = `${root}${file.cnpj}/${file.periodo}/${partsFolderId(file, SPED_READER_VERSION)}/`;
      const dir = path.join(work, partsFolderId(file, SPED_READER_VERSION));
      await mkdir(dir, { recursive: true });
      try {
        justRead.push({ file, marker: await readFile(importer, template, facts, file, folder, dir) });
      } catch (err) {
        if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not read", file.key, err);
        skipped.push({ path: relativeToOrg(access.org.slug, file.key), error: err instanceof FiscalFileError ? err.message : "não foi possível ler o arquivo" });
        await storage.removeFolder(folder).catch(() => undefined);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    // Only now: what was read again replaces its old parts, and deleted files' parts go.
    for (const f of plan.obsolete) await storage.removeFolder(`${root}${f.cnpj}/${f.periodo}/${f.id}/`).catch(() => undefined);

    const ready = [...plan.ready, ...justRead].sort((a, b) => a.file.periodo.localeCompare(b.file.periodo) || a.file.key.localeCompare(b.file.key));
    if (ready.length === 0) {
      throw new UserFacingError(skipped.length ? "Nenhum arquivo pôde ser lido." : "Nenhum arquivo enviado ainda.");
    }

    const tables: TableReport[] = [];
    const lineage: TableLineage[] = [];
    const relative = (key: string): string => relativeToOrg(access.org.slug, key);
    for (const table of facts) {
      if (options.only === "blocks" && table === facts[0]) continue;
      const keep = filesForFact(ready, table === facts[0] ? importer.kind.mainFactPeriods : "all");
      const parts = keep.flatMap((r) => r.marker.tables[table.name]?.key ?? []);
      // A block the files do not bring (a company without services) stays out: an extra fact may be missing.
      if (parts.length === 0) continue;
      const report = await assemble(access, table, parts, work, false);
      tables.push(report);
      lineage.push({
        table: table.name, kind: "fact", how: factHow(importer.kind, table.name, table === facts[0]),
        rows: report.ok ? report.rowCount : null, sources: sourcesOf(keep, table.name, "tables", relative),
      });
    }
    for (const table of template.tables.filter((t) => t.kind === "dimension")) {
      // What the dashboard already has, then what was read now; reading everything again starts from nothing.
      const base = options.rereadAll || justRead.length === ready.length ? null : await currentFile(access, table.name);
      const fresh = (base ? justRead : ready).flatMap((r) => r.marker.dimensions[table.name]?.key ?? []);
      const sources = [...(base ? [base] : []), ...fresh];
      if (sources.length === 0) {
        const source = path.join(work, `${table.name}.csv`);
        await writeFile(source, toCsv(table.columns.map((c) => c.name), [placeholderRow(table)]), "utf8");
        tables.push(await ingestIntoDraft(access, table, source, `${table.name}.csv`));
        continue;
      }
      const report = await assemble(access, table, sources, work, true);
      tables.push(report);
      lineage.push({
        table: table.name, kind: "dimension", how: dimensionHow(table.name), rows: report.ok ? report.rowCount : null,
        sources: sourcesOf(base ? justRead : ready, table.name, "dimensions", relative),
      });
    }
    const record: Lineage = {
      dashboard: access.instanceId, template: access.templateId, builtAt: new Date().toISOString(),
      reader: SPED_READER_VERSION, tables: lineage,
    };
    await keepLineage(access, record);
    return {
      ok: tables.every((t) => t.ok), lineage: record, files: ready.length, read: justRead.length, reused: plan.ready.length, skipped, tables,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
