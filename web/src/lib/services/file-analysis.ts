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
  fiscalStandardFolder, isStale, judge, parseCsvHeader, resolveCopies, spaceRoot,
  type CopyCandidate, type FileFacts, type SpaceDashboard, type Verdict,
} from "../storage-analysis";
import { relativeToOrg, type BrowseEntryFile } from "../storage-browse";
import { clientSlugOf, CLIENTS_DIR, isSystemPath, joinPath, parentOf } from "../storage-explorer";
import { fiscalDocumentId, fiscalFolder } from "../storage-keys";
import { getCatalogEntry } from "../templates/registry";
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
/** Files walked by "Organizar pasta" (folder and sub-folders). */
const MAX_ORGANIZE_FILES = 5000;

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
  const [dashboards, clients] = await Promise.all([listOrgDashboards(ctx.org.id), listClients(ctx.org.id)]);
  const slugOf = new Map(clients.map((c) => [c.id, c.slug]));
  const templates = new Map(
    await Promise.all([...new Set(dashboards.map((d) => d.templateId))].map(async (id) => [id, (await getCatalogEntry(id))?.template] as const)),
  );
  const bySpace = new Map<string, SpaceDashboard[]>();
  for (const d of dashboards) {
    const template = templates.get(d.templateId);
    if (!template) continue;
    const root = d.clientId ? `clientes/${slugOf.get(d.clientId) ?? ""}` : "";
    bySpace.set(root, [...(bySpace.get(root) ?? []), { name: d.name, templateId: d.templateId, tables: template.tables }]);
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

// ---------- "Organizar pasta": loose fiscal files to their standard folders ----------

export interface OrganizeMove {
  path: string;
  /** Destination folder (relative to the organization's folder). */
  to: string;
  layout: string;
  /** Ticked by default: the newest copy of its document (see resolveCopies). */
  suggested: boolean;
  /** The same document is already filed there: filing this one deletes it. */
  replaces: boolean;
  /** Why it is not suggested (an older copy). */
  note?: string;
}

export interface OrganizePlan {
  moves: OrganizeMove[];
  /** Fiscal files already in their standard folder. */
  inPlace: number;
  /** .txt / .xml files that are not a recognized fiscal layout (they stay where they are). */
  unrecognized: string[];
  /** Other files (CSV, Parquet, documents…) — never moved. */
  others: number;
  /** More files than one run looks at. */
  truncated: boolean;
}

/** Every file under a folder (sub-folders too, platform folders skipped), up to MAX_ORGANIZE_FILES. */
async function walkFiles(ctx: OrgContext, folder: string): Promise<{ files: { path: string; file: BrowseEntryFile }[]; truncated: boolean }> {
  const out: { path: string; file: BrowseEntryFile }[] = [];
  let level = [folder];
  let truncated = false;
  while (level.length > 0 && out.length < MAX_ORGANIZE_FILES) {
    const listed = await Promise.all(level.map(async (f) => ({ f, list: await folderListing(ctx, f) })));
    level = [];
    for (const { f, list } of listed) {
      truncated ||= list.truncated;
      // Files lying directly in "clientes" belong to no space: never filed from there.
      const parts = f.split("/").filter(Boolean);
      if (!(parts.length === 1 && parts[0] === CLIENTS_DIR)) {
        for (const file of visible(list.files)) out.push({ path: joinPath(f, file.name), file });
      }
      for (const sub of list.folders) {
        const path = joinPath(f, sub.replace(/\/$/, ""));
        if (!isSystemPath(path)) level.push(path);
      }
    }
  }
  return { files: out.slice(0, MAX_ORGANIZE_FILES), truncated: truncated || out.length > MAX_ORGANIZE_FILES || level.length > 0 };
}

/** Documents already filed in a destination folder, with their dates (errors fail the preview: never guess). */
async function filedIn(ctx: OrgContext, folder: string): Promise<{ documentId: string; updatedAt: string | null }[]> {
  const list = await folderListing(ctx, folder);
  return visible(list.files).map((f) => ({ documentId: fiscalDocumentId(f.name), updatedAt: current(f).updatedAt }));
}

interface Planned {
  plan: OrganizePlan;
  /** For each move, the file and its fiscal facts as read for the preview. */
  sources: Map<string, { file: BrowseEntryFile; facts: Extract<FileFacts, { kind: "fiscal" }> }>;
}

async function planOrganize(ctx: OrgContext, folder: string): Promise<Planned> {
  const base = folder.replace(/^\/+|\/+$/g, "");
  if (isSystemPath(base)) throw new UserFacingError("Esta pasta é da plataforma e não pode ser organizada.");
  const { files, truncated } = await walkFiles(ctx, base);
  const candidates = files.filter(({ file }) => ["txt", "xml"].includes(extOf(file.name)));
  const facts = await factsOf(ctx, candidates.map((c) => c.file));
  const plan: OrganizePlan = { moves: [], inPlace: 0, unrecognized: [], others: files.length - candidates.length, truncated };
  const sources: Planned["sources"] = new Map();
  const loose: (CopyCandidate & { layout: string })[] = [];
  for (const { path, file } of candidates) {
    const f = facts.get(file.key);
    if (!f || f.kind !== "fiscal") {
      plan.unrecognized.push(path);
      continue;
    }
    const to = fiscalStandardFolder(path, f.templateId, f.cnpj, f.periodo);
    if (parentOf(path) === to) {
      plan.inPlace += 1;
      continue;
    }
    sources.set(path, { file, facts: f });
    loose.push({ path, to, documentId: f.documentId, updatedAt: current(file).updatedAt, layout: `${f.title} · ${f.label}` });
  }
  const destinations = [...new Set(loose.map((m) => m.to))];
  const filed = new Map(await Promise.all(destinations.map(async (to) => [to, await filedIn(ctx, to)] as const)));
  const decisions = resolveCopies(loose, filed);
  plan.moves = loose.map((m, i) => ({ path: m.path, to: m.to, layout: m.layout, ...decisions[i] }));
  const byPath = (a: string, b: string): number => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  plan.moves.sort((a, b) => byPath(a.path, b.path));
  plan.unrecognized.sort(byPath);
  return { plan, sources };
}

export async function organizePreview(ctx: OrgContext, folder: string): Promise<OrganizePlan> {
  return (await planOrganize(ctx, folder)).plan;
}

export interface OrganizeResult {
  done: { path: string; to: string }[];
  failed: { path: string; error: string }[];
}

/**
 * Files the chosen loose fiscal files — only ones the preview (worked out again here) would move, and
 * never two copies of the same document at once (filing one would delete the other).
 */
export async function organizeApply(ctx: OrgContext, folder: string, paths: readonly string[]): Promise<OrganizeResult> {
  const { plan, sources } = await planOrganize(ctx, folder);
  const wanted = new Set(paths);
  const result: OrganizeResult = { done: [], failed: [] };
  const taken = new Set<string>();
  for (const move of plan.moves.filter((m) => wanted.has(m.path))) {
    const source = sources.get(move.path);
    if (!source) continue;
    const group = `${move.to}\u0000${source.facts.documentId}`;
    if (taken.has(group)) {
      result.failed.push({ path: move.path, error: "Outra cópia deste mesmo documento já foi escolhida." });
      continue;
    }
    taken.add(group);
    try {
      const f = source.facts;
      const target = fiscalFolder(ctx.org.slug, clientSlugOf(move.path), f.templateId);
      const filed = await fileFiscal(ctx.org.slug, target, source.file.key, source.file.name, { cnpj: f.cnpj, periodo: f.periodo, documentId: f.documentId, label: f.label });
      // What the explorer knows follows the file; replaced copies are forgotten. Bookkeeping never fails the move.
      await moveAnalyses(ctx.org.id, source.file.key, filed.key).catch((err: unknown) => console.error("[file-analysis] keep analysis", err));
      await forgetAnalyses(ctx.org.id, filed.replacedKeys).catch((err: unknown) => console.error("[file-analysis] forget analysis", err));
      result.done.push({ path: move.path, to: parentOf(relativeToOrg(ctx.org.slug, filed.key)) });
    } catch (err) {
      if (!(err instanceof UserFacingError)) console.error("[file-analysis] organize failed", move.path, err);
      result.failed.push({ path: move.path, error: err instanceof UserFacingError ? err.message : "Não foi possível mover." });
    }
  }
  return result;
}
