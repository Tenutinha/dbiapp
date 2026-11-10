/**
 * Browser cache of the explorer, per organization: folder listings (shown at once, refreshed behind) and
 * the clients / file uses ("meta"), asked once. Shared by every explorer and tree on the page.
 */
import type { ExplorerMeta } from "@/lib/storage-explorer";
import { explorerApi, type ExplorerFolder, type FileInsight } from "./api";

interface OrgCache {
  folders: Map<string, ExplorerFolder>;
  /** Listings in flight, so a hover prefetch and a click share one request. */
  pending: Map<string, Promise<ExplorerFolder>>;
  meta: Promise<ExplorerMeta> | null;
  /** What each file of a folder is (layout, ready or needs treatment), by folder. */
  insights: Map<string, Record<string, FileInsight>>;
  pendingInsights: Map<string, Promise<Record<string, FileInsight>>>;
  /** Bumped when a folder is forgotten: answers to older requests are dropped. */
  generation: Map<string, number>;
}

const orgs = new Map<string, OrgCache>();

function cacheOf(org: string): OrgCache {
  let c = orgs.get(org);
  if (!c) {
    c = { folders: new Map(), pending: new Map(), meta: null, insights: new Map(), pendingInsights: new Map(), generation: new Map() };
    orgs.set(org, c);
  }
  return c;
}

/** The last known listing of a folder (may be a little old), or undefined. */
export function peekFolder(org: string, folder: string): ExplorerFolder | undefined {
  return cacheOf(org).folders.get(folder);
}

/** Lists a folder from the server (joining a request already running for it) and keeps the result. */
export function loadFolder(org: string, folder: string): Promise<ExplorerFolder> {
  const c = cacheOf(org);
  const running = c.pending.get(folder);
  if (running) return running;
  const gen = c.generation.get(folder) ?? 0;
  const req = explorerApi.list(org, folder).then(
    (data) => {
      if ((c.generation.get(folder) ?? 0) === gen) c.folders.set(folder, data);
      c.pending.delete(folder);
      return data;
    },
    (err: unknown) => {
      c.pending.delete(folder);
      throw err;
    },
  );
  c.pending.set(folder, req);
  return req;
}

/** Loads a folder ahead of a click (hover), unless it is already known. Errors are ignored here. */
export function prefetchFolder(org: string, folder: string): void {
  if (!peekFolder(org, folder)) loadFolder(org, folder).catch(() => undefined);
}

/** Clients and file uses, once per organization (again after `refreshMeta`). */
export function loadMeta(org: string): Promise<ExplorerMeta> {
  const c = cacheOf(org);
  c.meta ??= explorerApi.meta(org).catch((err: unknown) => {
    c.meta = null; // try again next time
    throw err;
  });
  return c.meta;
}

export function refreshMeta(org: string): void {
  cacheOf(org).meta = null;
}

/** Forgets folders after a change (they are listed and analysed again on next view). */
export function forgetFolders(org: string, folders: readonly string[]): void {
  const c = cacheOf(org);
  for (const f of folders) {
    c.folders.delete(f);
    c.insights.delete(f);
    c.pending.delete(f);
    c.pendingInsights.delete(f);
    c.generation.set(f, (c.generation.get(f) ?? 0) + 1);
  }
}

export function peekInsights(org: string, folder: string): Record<string, FileInsight> | undefined {
  return cacheOf(org).insights.get(folder);
}

/** Analysis of a folder's files (joining a request already running for it). */
export function loadInsights(org: string, folder: string): Promise<Record<string, FileInsight>> {
  const c = cacheOf(org);
  const running = c.pendingInsights.get(folder);
  if (running) return running;
  const gen = c.generation.get(folder) ?? 0;
  const req = explorerApi.analyze(org, folder).then(
    (data) => {
      if ((c.generation.get(folder) ?? 0) === gen) c.insights.set(folder, data);
      c.pendingInsights.delete(folder);
      return data;
    },
    (err: unknown) => {
      c.pendingInsights.delete(folder);
      throw err;
    },
  );
  c.pendingInsights.set(folder, req);
  return req;
}
