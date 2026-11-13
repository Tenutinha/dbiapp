/**
 * The panel of fiscal data of a space (see fiscal/panel.ts): for each fiscal model, the files kept, what
 * each one became (read into parts, missing, failed) and the tables its dashboard publishes, plus the
 * lineage of those tables. Everyone who views the space sees it; organizing, reading, putting the tables
 * together and publishing stay with who manages the data (the API routes check it again).
 */
import "server-only";
import type { ClientRef, InstanceAccess, OrgRef } from "../access";
import { listSpaceDashboards, type SpaceDashboardRow } from "../data/instances";
import { getDraft, getVersion, listFiles } from "../data/repository";
import { FISCAL_IMPORTERS, fiscalImporterFor } from "../fiscal/importers";
import type { Lineage } from "../fiscal/lineage";
import {
  countStates, documentFileStatuses, fileMap, filesToRead, lineageSourcesPage, lineageTableView, parseLineage,
  spedFileStatuses, type FileMap, type FileStatus, type LineageTableView, type StateCounts,
} from "../fiscal/panel";
import type { LineageSource } from "../fiscal/lineage";
import { storage } from "../storage";
import { relativeToOrg } from "../storage-browse";
import { dashboardFolder } from "../storage-keys";
import { hostedLimits, LINEAGE_FILE, MAX_HOSTED_READ_BYTES, spedFilesOverview } from "./fiscal-parts";
import { looseSpaceFiles, storedFiscalFiles } from "./fiscal";

/** One table a dashboard has (published or in its draft). */
export interface PanelTable {
  table: string;
  rows: number;
  sizeBytes: number;
}

export interface PanelDashboard {
  id: string;
  name: string;
  publishedAt: string | null;
  /** Tables the dashboard shows now (the "gold"). */
  published: PanelTable[];
  /** Tables put together and not published yet. */
  draft: PanelTable[] | null;
}

/** A file as the panel lists it (paths relative to the organization's folder). */
export interface PanelFile {
  key: string;
  path: string;
  cnpj: string;
  periodo: string;
  sizeBytes: number;
  error?: string;
}

export interface PanelModel {
  templateId: string;
  title: string;
  mode: "sped" | "documents";
  /** The space's dashboard of this model (null: files kept, but no dashboard linked yet). */
  dashboard: PanelDashboard | null;
  counts: StateCounts;
  files: number;
  sizeBytes: number;
  map: FileMap;
  /** To read, in order (missing, then failed); only for who manages the data. */
  toRead: PanelFile[];
  failed: PanelFile[];
  /** Too big for the app: loaded by the script. */
  big: PanelFile[];
  /** Files dropped at the root of the model's folder. */
  loose: number;
  /** The storage could not be listed for this model. */
  error?: string;
}

export interface FiscalPanelView {
  models: PanelModel[];
  /** Files with a fiscal extension left at the root of the space's folder ("Organizar" files them). */
  looseInSpace: number;
  canManage: boolean;
  /** Biggest file one request of the app reads (null: no limit here, e.g. a local server). */
  maxReadBytes: number | null;
}

const asTables = (files: Awaited<ReturnType<typeof listFiles>>): PanelTable[] =>
  files.map((f) => ({ table: f.tableName, rows: f.rowCount, sizeBytes: f.sizeBytes }));

async function dashboardOf(row: SpaceDashboardRow): Promise<PanelDashboard> {
  const [published, draft] = await Promise.all([
    row.activeVersionId ? listFiles(row.activeVersionId) : Promise.resolve([]),
    row.draftId ? listFiles(row.draftId) : Promise.resolve(null),
  ]);
  return {
    id: row.id, name: row.name, publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    published: asTables(published), draft: draft && draft.length > 0 ? asTables(draft) : null,
  };
}

const panelFile = (orgSlug: string, s: FileStatus): PanelFile => ({
  key: s.key, path: relativeToOrg(orgSlug, s.key), cnpj: s.cnpj, periodo: s.periodo, sizeBytes: s.sizeBytes,
  ...(s.error ? { error: s.error } : {}),
});

async function loadModel(
  org: OrgRef, client: ClientRef | null, templateId: string, row: SpaceDashboardRow | undefined, canManage: boolean,
): Promise<PanelModel | null> {
  const importer = fiscalImporterFor(templateId);
  if (!importer) return null;
  const clientSlug = client?.slug || null;
  const base = { templateId, title: importer.title, mode: importer.mode } as const;
  try {
    const [stored, dashboard] = await Promise.all([
      storedFiscalFiles(org.slug, clientSlug, templateId),
      row ? dashboardOf(row) : Promise.resolve(null),
    ]);
    if (!dashboard && stored.files.length === 0 && stored.loose.length === 0) return null;
    const accepted = stored.files.filter((f) => importer.extensions.some((ext) => f.name.toLowerCase().endsWith(ext)));
    let statuses: FileStatus[];
    if (importer.mode === "documents") statuses = documentFileStatuses(accepted);
    else if (row) {
      const overview = await spedFilesOverview({ org, client, instanceId: row.id, templateId }, accepted);
      statuses = spedFileStatuses(accepted, overview.ready, overview.failures, hostedLimits() ? MAX_HOSTED_READ_BYTES : null);
    } else {
      statuses = spedFileStatuses(accepted, new Set(), new Map(), hostedLimits() ? MAX_HOSTED_READ_BYTES : null);
    }
    const toFile = (s: FileStatus): PanelFile => panelFile(org.slug, s);
    return {
      ...base, dashboard,
      counts: countStates(statuses), files: statuses.length, sizeBytes: statuses.reduce((sum, s) => sum + s.sizeBytes, 0),
      map: fileMap(statuses),
      toRead: canManage && row && importer.mode === "sped" ? filesToRead(statuses, true).map(toFile) : [],
      failed: statuses.filter((s) => s.state === "erro").map(toFile),
      big: statuses.filter((s) => s.state === "script").map(toFile),
      loose: stored.loose.length,
    };
  } catch (err) {
    console.error("[fiscal-panel] could not list", org.slug, templateId, err);
    return {
      ...base, dashboard: row ? await dashboardOf(row).catch(() => null) : null,
      counts: countStates([]), files: 0, sizeBytes: 0, map: fileMap([]), toRead: [], failed: [], big: [], loose: 0,
      error: "Não foi possível listar os arquivos deste molde agora.",
    };
  }
}

/** Everything the panel shows for a space: one entry per fiscal model with files or a dashboard. */
export async function loadFiscalPanel(org: OrgRef, client: ClientRef | null, canManage: boolean): Promise<FiscalPanelView> {
  const templateIds = FISCAL_IMPORTERS.map((i) => i.templateId);
  const rows = await listSpaceDashboards(org.id, client?.id ?? null, templateIds);
  const extensions = [...new Set(FISCAL_IMPORTERS.flatMap((i) => i.extensions))];
  const [models, looseInSpace] = await Promise.all([
    Promise.all(templateIds.map((id) => loadModel(org, client, id, rows.find((r) => r.templateId === id), canManage))),
    looseSpaceFiles(org.slug, client?.slug || null, extensions).catch(() => 0),
  ]);
  return {
    models: models.filter((m): m is PanelModel => m !== null),
    looseInSpace,
    canManage,
    maxReadBytes: hostedLimits() ? MAX_HOSTED_READ_BYTES : null,
  };
}

/** Which version's lineage: what the dashboard shows now, or what was put together and not published yet. */
export type LineageVersion = "publicada" | "rascunho";

async function lineageOf(access: InstanceAccess, which: LineageVersion): Promise<Lineage | null> {
  const version = which === "rascunho" ? await getDraft(access.instanceId) : access.activeVersionId ? await getVersion(access.activeVersionId) : null;
  if (!version) return null;
  const folder = dashboardFolder(access.org.slug, access.client?.slug || null, access.instanceId, access.templateId);
  try {
    const bytes = await storage.readFresh(`${folder}v${version.version}/${LINEAGE_FILE}`);
    return parseLineage(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null; // tables put together before the lineage existed, or by another kind of dashboard
  }
}

export interface LineageView {
  builtAt: string;
  reader: number;
  tables: LineageTableView[];
}

/** The lineage of a fiscal dashboard, one summary per table (the files themselves come page by page). */
export async function loadLineage(access: InstanceAccess, which: LineageVersion): Promise<LineageView | null> {
  const lineage = await lineageOf(access, which);
  return lineage ? { builtAt: lineage.builtAt, reader: lineage.reader, tables: lineage.tables.map(lineageTableView) } : null;
}

/** The files one table of the lineage came from, a page at a time (a table can come from thousands). */
export async function loadLineageSources(
  access: InstanceAccess, which: LineageVersion, table: string, offset: number, limit: number,
): Promise<{ total: number; sources: LineageSource[] } | null> {
  const found = (await lineageOf(access, which))?.tables.find((t) => t.table === table);
  return found ? lineageSourcesPage(found, offset, limit) : null;
}
