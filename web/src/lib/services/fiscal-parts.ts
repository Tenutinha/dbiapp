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
 *
 * The same steps also run apart, one request each, for the panel of fiscal data: `readSpedFile` reads one
 * file (progress "37 de 103", resumed by the markers if the page closes), `spedPartsState` says what is
 * read, missing or failed, and `assembleSpedFromParts` puts the draft together without reading anything.
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
  filesForFact, parseFailure, parseMarker, partsFolderId, planParts,
  type PartsFailure, type PartsFolder, type PartsMarker, type PartsPlan, type RawFile,
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
const FAILURE = "erro.json";
export const LINEAGE_FILE = "linhagem.json";
/** Raw bytes one serverless request can read (disk and time are limited there); files already read do not count. */
export const MAX_HOSTED_READ_BYTES = 250 * 1024 ** 2;
/** Whether this server runs where a request has those limits (the hosted app, not a script or a local server). */
export const hostedLimits = (): boolean => Boolean(process.env.VERCEL);

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

const readJson = async (key: string): Promise<unknown> => JSON.parse(new TextDecoder().decode(await storage.readFresh(key)));

/** The parts folders of a dashboard, with their markers (and failure records) read. */
async function listPartsFolders(root: string): Promise<PartsFolder[]> {
  // One listing of the whole tree, not one per folder (thousands of folders in a big client).
  const found = new Map<string, { cnpj: string; periodo: string; id: string; marker: boolean; failure: boolean }>();
  for (const f of await storage.listTree(root)) {
    const parts = f.key.slice(root.length).split("/");
    if (parts.length !== 4) continue;
    const [cnpj, periodo, id, name] = parts;
    const place = `${cnpj}/${periodo}/${id}`;
    const entry = found.get(place) ?? { cnpj, periodo, id, marker: false, failure: false };
    if (name === MARKER) entry.marker = true;
    if (name === FAILURE) entry.failure = true;
    found.set(place, entry);
  }
  return Promise.all([...found.values()].map(async (f) => {
    const folder = `${root}${f.cnpj}/${f.periodo}/${f.id}/`;
    const marker = f.marker ? await readJson(`${folder}${MARKER}`).then(parseMarker, () => null) : null;
    const failure = !marker && f.failure ? await readJson(`${folder}${FAILURE}`).then(parseFailure, () => null) : null;
    return { cnpj: f.cnpj, periodo: f.periodo, id: f.id, marker, failure };
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
    await storage.replaceBytes(`${folder}${MARKER}`, new TextEncoder().encode(JSON.stringify(marker)), JSON_MIME);
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
async function assembleTable(
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
    // Replaced at every "Montar tabelas" of the same draft (the bucket never overwrites an object).
    await storage.replaceBytes(`${folder}v${draft.version}/${LINEAGE_FILE}`, new TextEncoder().encode(JSON.stringify(lineage, null, 2)), JSON_MIME);
  } catch (err) {
    console.error("[fiscal] could not keep the lineage", access.instanceId, err);
  }
}

/** What locates a dashboard's folders in the bucket. */
export type DashboardRef = Pick<InstanceAccess, "org" | "client" | "instanceId" | "templateId">;

const partsRoot = (access: DashboardRef): string =>
  fiscalPartsFolder(access.org.slug, access.client?.slug || null, access.instanceId, access.templateId);
const folderOfFile = (root: string, file: RawFile): string =>
  `${root}${file.cnpj}/${file.periodo}/${partsFolderId(file, SPED_READER_VERSION)}/`;

/** What a failed read says on screen (a file the reader refuses says why; anything else stays generic). */
const failureMessage = (err: unknown): string => (err instanceof FiscalFileError ? err.message : "não foi possível ler o arquivo");

/**
 * Reads one raw file into its parts folder, emptied first (an interrupted read leaves parts behind, and the
 * bucket never overwrites). A failure empties it again and leaves only erro.json, so the panel can tell why
 * until the file (or the reader) changes. `work` is a local folder of this request.
 */
async function readOne(
  access: InstanceAccess, importer: SpedImporter, template: Template, facts: readonly TemplateTable[], file: RawFile, work: string,
): Promise<{ ok: true; marker: PartsMarker } | { ok: false; error: string }> {
  const folder = folderOfFile(partsRoot(access), file);
  const dir = path.join(work, partsFolderId(file, SPED_READER_VERSION));
  await mkdir(dir, { recursive: true });
  try {
    await storage.removeFolder(folder);
    return { ok: true, marker: await readFile(importer, template, facts, file, folder, dir) };
  } catch (err) {
    if (!(err instanceof FiscalFileError)) console.error("[fiscal] could not read", file.key, err);
    const failure: PartsFailure = { error: failureMessage(err), at: new Date().toISOString() };
    await storage.removeFolder(folder).catch(() => undefined);
    await storage.replaceBytes(`${folder}${FAILURE}`, new TextEncoder().encode(JSON.stringify(failure)), JSON_MIME)
      .catch((e: unknown) => console.error("[fiscal] could not keep the failure of", file.key, e));
    return { ok: false, error: failure.error };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Where each stored raw file stands, as the panel shows it (markers are not read: only whether they exist). */
export interface SpedFilesOverview {
  /** Raw file keys whose parts are complete for this content and this reader. */
  ready: Set<string>;
  /** Raw file key → why its last read failed. */
  failures: Map<string, PartsFailure>;
}

/**
 * The quick look of the panel: a file is read when its folder (named by its content and the reader) has a
 * marker. One listing of the two record names for the whole dashboard; only the failure records are read.
 * A template that gained a table is only noticed when the tables are put together (the files are then read
 * again), never here.
 */
export async function spedFilesOverview(access: DashboardRef, files: readonly RawFile[]): Promise<SpedFilesOverview> {
  const root = partsRoot(access);
  const records = new Map<string, Set<string>>();
  for (const f of await storage.listTree(root, [MARKER, FAILURE])) {
    const place = f.key.slice(root.length, f.key.length - f.name.length);
    records.set(place, (records.get(place) ?? new Set()).add(f.name));
  }
  const ready = new Set<string>();
  const failed: RawFile[] = [];
  for (const file of files) {
    const names = records.get(folderOfFile("", file));
    if (names?.has(MARKER)) ready.add(file.key);
    else if (names?.has(FAILURE)) failed.push(file);
  }
  const failures = new Map<string, PartsFailure>();
  await Promise.all(failed.map(async (file) => {
    const failure = await readJson(`${folderOfFile(root, file)}${FAILURE}`).then(parseFailure, () => null);
    if (failure) failures.set(file.key, failure);
  }));
  return { ready, failures };
}

/** What is read, what is missing and what failed, for the stored raw files of a SPED dashboard. */
export interface SpedPartsState {
  plan: PartsPlan;
  /** Raw file key → why its last read failed (files in plan.read only). */
  failures: Map<string, PartsFailure>;
}

/** Lists the dashboard's parts and plans them against the stored files (reads every marker). */
export async function spedPartsState(
  access: InstanceAccess, importer: SpedImporter, template: Template, files: readonly RawFile[],
): Promise<SpedPartsState> {
  const folders = await listPartsFolders(partsRoot(access));
  const plan = planParts(files, folders, spedFacts(importer, template).map((t) => t.name), SPED_READER_VERSION);
  const byPlace = new Map(folders.map((f) => [`${f.cnpj}/${f.periodo}/${f.id}`, f]));
  const failures = new Map<string, PartsFailure>();
  for (const file of plan.read) {
    const failure = byPlace.get(`${file.cnpj}/${file.periodo}/${partsFolderId(file, SPED_READER_VERSION)}`)?.failure;
    if (failure) failures.set(file.key, failure);
  }
  return { plan, failures };
}

export type ReadFileResult = { ok: true; rows: number } | { ok: false; error: string };

/** Reads one stored raw file into its parts (the panel calls this once per file, with progress on screen). */
export async function readSpedFile(
  access: InstanceAccess, importer: SpedImporter, template: Template, file: RawFile,
): Promise<ReadFileResult> {
  if (hostedLimits() && file.sizeBytes > MAX_HOSTED_READ_BYTES) {
    throw new UserFacingError(
      `${file.name} tem ${Math.round(file.sizeBytes / 1024 ** 2)} MB, mais do que dá para ler por aqui. Peça à equipe da DBI para carregá-lo pelo script.`,
    );
  }
  const work = path.join(storage.workRoot, "_fiscal", `${access.instanceId}-${Date.now()}-ler`);
  await mkdir(work, { recursive: true });
  try {
    const result = await readOne(access, importer, template, spedFacts(importer, template), file, work);
    if (!result.ok) return result;
    return { ok: true, rows: result.marker.tables[mainFact(template).name]?.rows ?? 0 };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** "Montar tabelas" for a SPED dashboard, reading only the files that are new or changed. */
export async function rebuildSpedFromParts(
  access: InstanceAccess, importer: SpedImporter, template: Template, files: readonly RawFile[], options: PartsOptions = {},
): Promise<PartsRebuildResult> {
  const root = partsRoot(access);
  const facts = spedFacts(importer, template);
  let folders = await listPartsFolders(root);
  if (options.rereadAll) {
    // Reading everything again starts from no parts at all (a file would land in the folder it had).
    for (const f of folders) await storage.removeFolder(`${root}${f.cnpj}/${f.periodo}/${f.id}/`);
    folders = [];
  }
  const plan = planParts(files, folders, facts.map((t) => t.name), SPED_READER_VERSION);

  const bytes = plan.read.reduce((s, f) => s + f.sizeBytes, 0);
  if (hostedLimits() && bytes > MAX_HOSTED_READ_BYTES) {
    throw new UserFacingError(
      `Há ${plan.read.length} arquivo(s) novo(s) ou alterado(s) somando ${Math.round(bytes / 1024 ** 2)} MB, mais do que dá para ler de uma vez. Leia arquivo a arquivo no painel de dados fiscais ou peça à equipe da DBI para processar este volume.`,
    );
  }

  const work = path.join(storage.workRoot, "_fiscal", `${access.instanceId}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const skipped: PartsRebuildResult["skipped"] = [];
  const justRead: { file: RawFile; marker: PartsMarker }[] = [];
  try {
    for (const file of plan.read) {
      const result = await readOne(access, importer, template, facts, file, work);
      if (result.ok) justRead.push({ file, marker: result.marker });
      else skipped.push({ path: relativeToOrg(access.org.slug, file.key), error: result.error });
    }
    return await assemble(
      access, importer, template,
      { plan, justRead, skipped, dimensionsFrom: options.rereadAll ? "read" : "dashboard", only: options.only }, work,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Puts the draft together from the parts already read, without reading any raw file: the last step of the
 * panel's file-by-file load. Refuses while files are still to be read (the tables would miss them); files
 * whose read failed stay out, as in "Montar tabelas".
 */
export async function assembleSpedFromParts(
  access: InstanceAccess, importer: SpedImporter, template: Template, files: readonly RawFile[],
): Promise<PartsRebuildResult> {
  const { plan, failures } = await spedPartsState(access, importer, template, files);
  const pending = plan.read.filter((f) => !failures.has(f.key));
  if (pending.length > 0) {
    throw new UserFacingError(`Ainda há ${pending.length} arquivo(s) para ler antes de montar as tabelas.`);
  }
  const skipped = plan.read.map((f) => ({ path: relativeToOrg(access.org.slug, f.key), error: failures.get(f.key)?.error ?? "" }));
  const work = path.join(storage.workRoot, "_fiscal", `${access.instanceId}-${Date.now()}-montar`);
  await mkdir(work, { recursive: true });
  try {
    // The files were read in earlier requests: the dimensions come from every file's parts.
    return await assemble(access, importer, template, { plan, justRead: [], skipped, dimensionsFrom: "read" }, work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

interface AssembleInput {
  plan: PartsPlan;
  justRead: { file: RawFile; marker: PartsMarker }[];
  skipped: PartsRebuildResult["skipped"];
  /**
   * Dimensions: "dashboard" = what the dashboard has plus what was read now (a month added to a long
   * history); "read" = only from the parts of every file.
   */
  dimensionsFrom: "dashboard" | "read";
  only?: "blocks";
}

/** Drops obsolete parts, puts every table of the draft together from the parts, and keeps the lineage. */
async function assemble(
  access: InstanceAccess, importer: SpedImporter, template: Template, input: AssembleInput, work: string,
): Promise<PartsRebuildResult> {
  const root = partsRoot(access);
  const facts = spedFacts(importer, template);
  const { plan, justRead, skipped } = input;
  // Only now: replaced and deleted files' parts go.
  for (const f of plan.obsolete) await storage.removeFolder(`${root}${f.cnpj}/${f.periodo}/${f.id}/`).catch(() => undefined);

  const ready = [...plan.ready, ...justRead].sort((a, b) => a.file.periodo.localeCompare(b.file.periodo) || a.file.key.localeCompare(b.file.key));
  if (ready.length === 0) {
    throw new UserFacingError(skipped.length ? "Nenhum arquivo pôde ser lido." : "Nenhum arquivo enviado ainda.");
  }

  const tables: TableReport[] = [];
  const lineage: TableLineage[] = [];
  const relative = (key: string): string => relativeToOrg(access.org.slug, key);
  for (const table of facts) {
    if (input.only === "blocks" && table === facts[0]) continue;
    const keep = filesForFact(ready, table === facts[0] ? importer.kind.mainFactPeriods : "all");
    const parts = keep.flatMap((r) => r.marker.tables[table.name]?.key ?? []);
    // A block the files do not bring (a company without services) stays out: an extra fact may be missing.
    if (parts.length === 0) continue;
    const report = await assembleTable(access, table, parts, work, false);
    tables.push(report);
    lineage.push({
      table: table.name, kind: "fact", how: factHow(importer.kind, table.name, table === facts[0]),
      rows: report.ok ? report.rowCount : null, sources: sourcesOf(keep, table.name, "tables", relative),
    });
  }
  for (const table of template.tables.filter((t) => t.kind === "dimension")) {
    // What the dashboard already has, then what was read now; when every file was read now, only them.
    const base = input.dimensionsFrom === "read" || justRead.length === ready.length ? null : await currentFile(access, table.name);
    const fresh = (base ? justRead : ready).flatMap((r) => r.marker.dimensions[table.name]?.key ?? []);
    const sources = [...(base ? [base] : []), ...fresh];
    if (sources.length === 0) {
      const source = path.join(work, `${table.name}.csv`);
      await writeFile(source, toCsv(table.columns.map((c) => c.name), [placeholderRow(table)]), "utf8");
      tables.push(await ingestIntoDraft(access, table, source, `${table.name}.csv`));
      continue;
    }
    const report = await assembleTable(access, table, sources, work, true);
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
}
