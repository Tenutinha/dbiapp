import "server-only";
import { readFile, rm } from "node:fs/promises";
import type { OrgContext } from "../access";
import { forgetAnalyses, moveAnalyses, readAnalyses, saveAnalyses, type StoredAnalysis } from "../data/file-analysis";
import { listOrgDashboards } from "../data/instances";
import { listClients } from "../data/organizations";
import { FISCAL_IMPORTERS, SPED_HEAD_BYTES } from "../fiscal/importers";
import { describeSource } from "../ingest/ingest";
import { storage, StorageKeyError } from "../storage";
import {
  fiscalStandardFolder, isSameFiscalDocument, isStale, isStandardPeriodFolder, judge, parseCsvHeader, spaceRoot,
  type FileFacts, type SpaceDashboard, type Verdict,
} from "../storage-analysis";
import { relativeToOrg, type BrowseEntryFile } from "../storage-browse";
import { clientSlugOf, CLIENTS_DIR, isReadOnlyPath, isSystemPath, joinPath, parentOf } from "../storage-explorer";
import { fiscalFolder } from "../storage-keys";
import { getCatalogEntry } from "../templates/registry";
import { inputTable } from "../templates/schema";
import { UserFacingError } from "./datasets";
import { fileFiscal } from "./fiscal";

/**
 * The file explorer's "intelligence": what each stored file is (layout), whether it can feed a dashboard
 * of its space as it is or needs treatment, and filing loose fiscal files in the standard folders.
 * Files are read once (only their first bytes when possible) and the facts are kept (migration 013).
 */

/** Bytes read to find a CSV header or a SPED 0000 record. */
const HEAD_BYTES = 64 * 1024;
/** Bigger files are not downloaded just to be analysed. */
const MAX_PARQUET_BYTES = 50 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;
/** Files analysed at the same time. */
const PARALLEL = 6;

const DOCUMENT_EXTENSIONS = new Set(["json", "zip", "xlsx", "xls", "pdf", "pbix"]);

const extOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** A whole object, read through a local copy that is dropped afterwards on cloud storage. */
async function readWhole<T>(key: string, run: (localPath: string) => Promise<T>): Promise<T> {
  const local = await storage.localPath(key);
  try {
    return await run(local);
  } finally {
    if (storage.remote()) await rm(local, { force: true }).catch(() => undefined);
  }
}

function fiscalFacts(bytes: Uint8Array, mode: "sped" | "documents"): FileFacts | null {
  for (const importer of FISCAL_IMPORTERS.filter((i) => i.mode === mode)) {
    try {
      const id = importer.identify(bytes);
      return { v: 1, kind: "fiscal", templateId: importer.templateId, title: importer.title, ...id };
    } catch {
      // not this kind: try the next one
    }
  }
  return null;
}

/** What a file is, and whether reading it failed (a failure is shown as "unknown" but never kept). */
interface ReadOutcome {
  facts: FileFacts;
  failed: boolean;
}

/** Reads what a file is. Never throws: a file that cannot be read now is "unknown" (and read again next time). */
export async function readFacts(file: BrowseEntryFile): Promise<ReadOutcome> {
  const ext = extOf(file.name);
  const ok = (facts: FileFacts): ReadOutcome => ({ facts, failed: false });
  try {
    if (DOCUMENT_EXTENSIONS.has(ext)) return ok({ v: 1, kind: "document" });
    if (ext === "txt" || ext === "csv") {
      const head = await storage.readHead(file.key, HEAD_BYTES);
      const fiscal = ext === "txt" ? fiscalFacts(head.subarray(0, SPED_HEAD_BYTES), "sped") : null;
      if (fiscal) return ok(fiscal);
      const columns = parseCsvHeader(head);
      return ok(columns.length >= (ext === "csv" ? 1 : 2) ? { v: 1, kind: "table", format: "csv", columns } : { v: 1, kind: "unknown", format: ext });
    }
    if (ext === "xml") {
      if (file.sizeBytes > MAX_XML_BYTES) return ok({ v: 1, kind: "unknown", format: "xml" });
      const bytes = await readWhole(file.key, async (local) => new Uint8Array(await readFile(local)));
      return ok(fiscalFacts(bytes, "documents") ?? { v: 1, kind: "unknown", format: "xml" });
    }
    if (ext === "parquet") {
      if (file.sizeBytes > MAX_PARQUET_BYTES) return ok({ v: 1, kind: "deferred", format: "parquet" });
      const columns = await readWhole(file.key, async (local) => (await describeSource(storage.workRoot, local, "parquet")).map((c) => c.name));
      return ok({ v: 1, kind: "table", format: "parquet", columns });
    }
    return ok({ v: 1, kind: "unknown", format: ext || "arquivo" });
  } catch (err) {
    console.error("[file-analysis] could not read", file.key, err);
    return { facts: { v: 1, kind: "unknown", format: ext || "arquivo" }, failed: true };
  }
}

/** Runs `work` over the items, `parallel` at a time, keeping the order of the results. */
async function pool<T, R>(items: readonly T[], work: (item: T) => Promise<R>, parallel = PARALLEL): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
  return out;
}

/** The dashboards of every space of the organization ("" = its own, "clientes/<slug>" = a client's). */
async function spaceDashboards(ctx: OrgContext): Promise<Map<string, SpaceDashboard[]>> {
  const [dashboards, clients] = await Promise.all([listOrgDashboards(ctx.org.id, { platformAdmin: ctx.membership.platformAdmin === true }), listClients(ctx.org.id)]);
  const slugOf = new Map(clients.map((c) => [c.id, c.slug]));
  const templates = new Map(
    await Promise.all([...new Set(dashboards.map((d) => d.templateId))].map(async (id) => [id, (await getCatalogEntry(id))?.template] as const)),
  );
  const bySpace = new Map<string, SpaceDashboard[]>();
  for (const d of dashboards) {
    const template = templates.get(d.templateId);
    if (!template) continue;
    const root = d.clientId ? `clientes/${slugOf.get(d.clientId) ?? ""}` : "";
    bySpace.set(root, [...(bySpace.get(root) ?? []), { name: d.name, templateId: d.templateId, tables: template.tables.map(inputTable) }]);
  }
  return bySpace;
}

const current = (f: BrowseEntryFile) => ({ sizeBytes: f.sizeBytes, updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : null });

/** New analyses are kept in batches, so a long first run that stops halfway still keeps what it read. */
const SAVE_BATCH = 30;

/** Facts of these files: kept ones when the file did not change, fresh ones (and kept) otherwise. */
async function factsOf(ctx: OrgContext, files: readonly BrowseEntryFile[]): Promise<Map<string, FileFacts>> {
  const stored = new Map((await readAnalyses(ctx.org.id, files.map((f) => f.key))).map((a) => [a.key, a]));
  const out = new Map([...stored.values()].map((a) => [a.key, a.facts] as const));
  const stale = files.filter((f) => isStale(stored.get(f.key), current(f)));
  for (let i = 0; i < stale.length; i += SAVE_BATCH) {
    const batch = stale.slice(i, i + SAVE_BATCH);
    const read = await pool(batch, async (f) => ({ f, outcome: await readFacts(f) }));
    const keep: StoredAnalysis[] = [];
    for (const { f, outcome } of read) {
      out.set(f.key, outcome.facts);
      if (!outcome.failed) keep.push({ key: f.key, ...current(f), facts: outcome.facts });
    }
    await saveAnalyses(ctx.org.id, keep);
  }
  return out;
}

export interface FileInsight {
  facts: FileFacts;
  verdict: Verdict;
}

/** Files listed per folder (same cap as the fiscal importer, so the preview sees what filing will touch). */
const LIST_CAP = 20_000;

function folderListing(ctx: OrgContext, folder: string) {
  return storage.listOrgFolder(ctx.org.slug, folder, LIST_CAP).catch((err: unknown) => {
    if (err instanceof StorageKeyError) throw new UserFacingError("Pasta inválida. Use nomes simples separados por /.");
    throw err;
  });
}

const visible = (files: readonly BrowseEntryFile[]): BrowseEntryFile[] =>
  files.filter((f) => f.name !== "" && !f.name.endsWith(".emptyFolderPlaceholder"));

/** Files analysed per folder view (the explorer lists up to 2000). */
const ANALYZE_CAP = 2000;

/** Layout and verdict of every file of a folder, by path (relative to the organization's folder). */
export async function analyzeFolder(ctx: OrgContext, folder: string): Promise<Record<string, FileInsight>> {
  const base = folder.replace(/^\/+|\/+$/g, "");
  if (isSystemPath(base)) throw new UserFacingError("Esta pasta é da plataforma e não aparece aqui.");
  const [list, spaces] = await Promise.all([folderListing(ctx, base), spaceDashboards(ctx)]);
  const files = visible(list.files).slice(0, ANALYZE_CAP);
  const facts = await factsOf(ctx, files);
  const space = spaces.get(spaceRoot(base)) ?? [];
  return Object.fromEntries(
    files.flatMap((f) => {
      const known = facts.get(f.key);
      const path = joinPath(base, f.name);
      return known ? [[path, { facts: known, verdict: judge(known, path, space) }]] : [];
    }),
  );
}

// ---------- "Organizar pasta": loose fiscal files to their standard folders, a batch at a time ----------

/**
 * Where an organize run stands, kept by the browser between steps: the folders still to look at (the first
 * is the current one) and how many files at the start of the current folder stay where they are. Files are
 * listed by name and the filed ones leave the folder, so the ones that stay are always the first ones.
 */
export interface OrganizeCursor {
  queue: string[];
  /** Files at the start of queue[0] already looked at and left in place. */
  skip: number;
  /** Whether the sub-folders of queue[0] were already added to the queue. */
  expanded: boolean;
}

export interface OrganizeStep {
  /** Filed now: from → destination folder. */
  moved: { path: string; to: string }[];
  /** Fiscal files left where they are, with why (a newer copy is already filed, or the move failed). */
  kept: { path: string; reason: string }[];
  /** .txt / .xml files that are not a recognized fiscal layout. */
  unrecognized: number;
  /** Other files (CSV, Parquet, documents…), never moved. */
  others: number;
  /** Files looked at in this step. */
  scanned: number;
  /** Where to go on; null when the folder is done. */
  next: OrganizeCursor | null;
}

/** Files looked at per step: each one may be read and moved, so a step ends well within the time limit. */
const STEP_FILES = 40;
/** A step also stops after this long (many small folders cost listings, not files). */
const STEP_MS = 20_000;
const MAX_QUEUE = 20_000;

function startCursor(base: string, cursor: OrganizeCursor | null): OrganizeCursor {
  if (!cursor) return { queue: [base], skip: 0, expanded: false };
  // The browser only hands back what a step gave it; still, never leave the folder being organized.
  const inside = (p: string): boolean => base === "" || p === base || p.startsWith(`${base}/`);
  if (cursor.queue.length > MAX_QUEUE || !cursor.queue.every((p) => inside(p) && !isReadOnlyPath(p))) {
    throw new UserFacingError("Organização interrompida. Abra “Organizar pasta” de novo.");
  }
  return { queue: [...cursor.queue], skip: Math.max(0, Math.floor(cursor.skip)), expanded: cursor.expanded === true };
}

const byName = (a: BrowseEntryFile, b: BrowseEntryFile): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * One step of "Organizar pasta": looks at the next files of the folder (sub-folders too) and files the
 * recognized fiscal ones in their standard folder, keeping their names. It never lists the whole tree
 * first, so a folder of any size starts at once; the browser calls again with `next` until it is null.
 * Standard period folders are not opened (what is there is already in place).
 */
export async function organizeStep(
  ctx: OrgContext, folder: string, cursor: OrganizeCursor | null, stepFiles: number = STEP_FILES,
): Promise<OrganizeStep> {
  const base = folder.replace(/^\/+|\/+$/g, "");
  if (isReadOnlyPath(base)) throw new UserFacingError("Esta pasta é da plataforma e não pode ser organizada.");
  const c = startCursor(base, cursor);
  const out: OrganizeStep = { moved: [], kept: [], unrecognized: 0, others: 0, scanned: 0, next: null };
  const started = Date.now();
  const filedCache = new Map<string, BrowseEntryFile[]>();

  while (c.queue.length > 0 && out.scanned < stepFiles && Date.now() - started < STEP_MS) {
    const current = c.queue[0];
    const leave = (): void => {
      c.queue.shift();
      c.skip = 0;
      c.expanded = false;
    };
    if (isStandardPeriodFolder(current)) {
      leave();
      continue;
    }
    const list = await folderListing(ctx, current);
    if (!c.expanded) {
      const subs = list.folders.map((sub) => joinPath(current, sub.replace(/\/$/, ""))).filter((p) => !isReadOnlyPath(p));
      c.queue.push(...subs.slice(0, MAX_QUEUE - c.queue.length));
      c.expanded = true;
    }
    // Files lying directly in "clientes" belong to no space: never filed from there.
    const parts = current.split("/").filter(Boolean);
    const files = parts.length === 1 && parts[0] === CLIENTS_DIR ? [] : visible(list.files).sort(byName);
    const batch = files.slice(c.skip, c.skip + (stepFiles - out.scanned));
    if (batch.length === 0) {
      leave();
      continue;
    }
    const facts = await factsOf(ctx, batch.filter((f) => ["txt", "xml"].includes(extOf(f.name))));
    let stayed = 0;
    for (const file of batch) {
      out.scanned += 1;
      const path = joinPath(current, file.name);
      const f = facts.get(file.key);
      if (!["txt", "xml"].includes(extOf(file.name))) {
        out.others += 1;
        stayed += 1;
        continue;
      }
      if (!f || f.kind !== "fiscal") {
        out.unrecognized += 1;
        stayed += 1;
        continue;
      }
      const to = fiscalStandardFolder(path, f.templateId, f.cnpj, f.periodo);
      if (parentOf(path) === to) {
        stayed += 1;
        continue;
      }
      const reason = await keepReason(ctx, filedCache, to, file, f.documentId);
      if (reason) {
        out.kept.push({ path, reason });
        stayed += 1;
        continue;
      }
      try {
        const target = fiscalFolder(ctx.org.slug, clientSlugOf(path), f.templateId);
        const filed = await fileFiscal(ctx.org.slug, target, file.key, file.name, { cnpj: f.cnpj, periodo: f.periodo, documentId: f.documentId, label: f.label });
        filedCache.delete(to);
        // What the explorer knows follows the file; replaced copies are forgotten. Bookkeeping never fails the move.
        await moveAnalyses(ctx.org.id, file.key, filed.key).catch((err: unknown) => console.error("[file-analysis] keep analysis", err));
        await forgetAnalyses(ctx.org.id, filed.replacedKeys).catch((err: unknown) => console.error("[file-analysis] forget analysis", err));
        out.moved.push({ path, to: parentOf(relativeToOrg(ctx.org.slug, filed.key)) });
      } catch (err) {
        if (!(err instanceof UserFacingError)) console.error("[file-analysis] organize failed", path, err);
        out.kept.push({ path, reason: err instanceof UserFacingError ? err.message : "Não foi possível mover." });
        stayed += 1;
      }
    }
    c.skip += stayed;
  }
  out.next = c.queue.length > 0 ? c : null;
  return out;
}

/** Why a loose copy must not be filed: the copy of the same document already filed is newer. */
async function keepReason(
  ctx: OrgContext, cache: Map<string, BrowseEntryFile[]>, to: string, file: BrowseEntryFile, documentId: string,
): Promise<string | null> {
  if (!cache.has(to)) cache.set(to, visible((await folderListing(ctx, to)).files));
  const ext = file.name.toLowerCase().endsWith(".xml") ? "xml" : "txt";
  const mine = current(file).updatedAt ?? "";
  const newer = (cache.get(to) ?? []).some((f) => isSameFiscalDocument(f.name, documentId, ext) && (current(f).updatedAt ?? "") > mine);
  return newer ? "A cópia já arquivada é mais nova; esta ficou onde está." : null;
}

/** What a whole run did, for the explorer's notice once the dialog closes. */
export interface OrganizeResult {
  done: { path: string; to: string }[];
  failed: { path: string; error: string }[];
}
