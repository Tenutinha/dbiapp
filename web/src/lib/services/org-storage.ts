import "server-only";
import { getOrgContext, orgActions, requireAction, type OrgContext } from "../access";
import { forgetAnalyses, moveAnalyses } from "../data/file-analysis";
import { listFileUses } from "../data/instances";
import { listClients } from "../data/organizations";
import { storage, StorageKeyError } from "../storage";
import { browsePrefix } from "../storage-browse";
import {
  canMoveTo, isDashboardsPath, isProtectedFolder, isSystemPath, joinPath, parentOf, renamedFileName, safeFolderName, targetProblem,
  type ExplorerEntry, type ExplorerMeta,
} from "../storage-explorer";
import { STORABLE_EXTENSIONS, storableFileName } from "../storage-keys";
import { checkSize, UserFacingError } from "./datasets";

/**
 * The organization's file explorer (admin "Arquivos"): browse every folder of orgs/<slug>/, store files,
 * create, rename, move and delete. Paths are relative to the organization's folder and always go through
 * browsePrefix, so nothing can leave it; file names are looked up in the server's own listing.
 */

/** One folder as stored (only the bucket is read: clients and uses come once, from explorerMeta). */
export interface ExplorerFolder {
  folder: string;
  entries: ExplorerEntry[];
  /** More files than one listing shows. */
  truncated: boolean;
}

/** Outcome of an action on several items: what went and what did not (with the reason). */
export interface BatchResult {
  done: string[];
  failed: { path: string; error: string }[];
}

const LIST_LIMIT = 2000;

/** Org staff who manage data (admins, data editors) — the same people who upload in the data connector. */
export async function requireOrgStorage(orgSlug: string): Promise<OrgContext> {
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "manageData");
  return ctx;
}

function cleanFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

async function listing(orgSlug: string, folder: string) {
  try {
    return await storage.listOrgFolder(orgSlug, cleanFolder(folder), LIST_LIMIT);
  } catch (err) {
    if (err instanceof StorageKeyError) throw new UserFacingError("Pasta inválida. Use nomes simples separados por /.");
    throw err;
  }
}

function visibleFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((f) => f.name !== "" && !f.name.endsWith(".emptyFolderPlaceholder"));
}

export async function listExplorerFolder(ctx: OrgContext, folder: string): Promise<ExplorerFolder> {
  const base = cleanFolder(folder);
  if (isSystemPath(base)) throw new UserFacingError("Esta pasta é da plataforma e não aparece aqui.");
  const list = await listing(ctx.org.slug, base);
  // The platform's own folders (published data, uploads, logos) are never shown.
  const folders: ExplorerEntry[] = list.folders.filter((f) => !isSystemPath(joinPath(base, f.replace(/\/$/, "")))).map((f) => {
    const path = joinPath(base, f.replace(/\/$/, ""));
    return { name: f.replace(/\/$/, ""), path, folder: true, sizeBytes: 0, updatedAt: null };
  });
  const files: ExplorerEntry[] = visibleFiles(list.files).map((f) => ({
    name: f.name,
    path: joinPath(base, f.name),
    folder: false,
    sizeBytes: f.sizeBytes,
    updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : null,
  }));
  return { folder: base, entries: [...folders, ...files], truncated: list.truncated };
}

/** Clients (to label their folders) and the files dashboards used ("Usado em") — asked once per explorer. */
export async function explorerMeta(ctx: OrgContext): Promise<ExplorerMeta> {
  const [clients, uses] = await Promise.all([listClients(ctx.org.id), listFileUses(ctx.org.id)]);
  return { clients: clients.map((c) => ({ slug: c.slug, name: c.name })), uses };
}

/** The organization as these functions need it. */
export interface OrgRef {
  id: string;
  slug: string;
}

/** Refuses putting things in "clientes" itself or in a folder that looks like a client but is not one. */
async function assertTarget(org: OrgRef, folder: string): Promise<void> {
  const problem = targetProblem(cleanFolder(folder), new Set((await listClients(org.id)).map((c) => c.slug)));
  if (problem) throw new UserFacingError(problem);
}

// ---------- new files (shared with the data connector) ----------

/** A free name in the folder: "notas.xml", then "notas-2.xml", "notas-3.xml"… (stored files are never overwritten). */
function freeName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new UserFacingError("Já existem arquivos demais com esse nome nesta pasta.");
}

/** Key for a new file in a folder of the organization, after validating its name, size and the folder. */
export async function newFolderFileKey(orgSlug: string, folder: string, fileName: string, size: number): Promise<{ key: string; name: string }> {
  checkSize(size);
  const safe = storableFileName(fileName);
  if (!safe) throw new UserFacingError(`Tipo de arquivo não aceito. Envie ${STORABLE_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`);
  const list = await listing(orgSlug, folder);
  const name = freeName(new Set(list.files.map((f) => f.name)), safe);
  return { key: `${browsePrefix(orgSlug, cleanFolder(folder))}${name}`, name };
}

export type FolderUploadPlan = { mode: "direct"; name: string } | { mode: "signed"; name: string; signedUrl: string };

export async function planUpload(org: OrgRef, folder: string, fileName: string, size: number): Promise<FolderUploadPlan> {
  await assertTarget(org, folder);
  const { key, name } = await newFolderFileKey(org.slug, folder, fileName, size);
  const target = await storage.createUploadTarget(key);
  return target ? { mode: "signed", name, signedUrl: target.signedUrl } : { mode: "direct", name };
}

/** Local storage: the file comes in the request body. */
export async function storeUpload(org: OrgRef, folder: string, file: File): Promise<{ name: string }> {
  await assertTarget(org, folder);
  const { key, name } = await newFolderFileKey(org.slug, folder, file.name, file.size);
  await storage.putBytes(key, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream");
  return { name };
}

// ---------- organizing ----------

/** Creates a sub-folder; nested paths ("2026/julho") create every level. Returns the new folder's path. */
export async function createFolder(ctx: OrgContext, folder: string, name: string): Promise<{ path: string }> {
  const parts = name.split("/").map((p) => safeFolderName(p)).filter((p): p is string => p !== null);
  if (parts.length === 0) throw new UserFacingError("Dê um nome para a pasta.");
  const path = joinPath(cleanFolder(folder), parts.join("/"));
  await assertTarget(ctx.org, path);
  await storage.createFolder(browsePrefix(ctx.org.slug, path));
  return { path };
}

/** The item at `path` as the server sees it (a request never names an object directly). */
async function find(ctx: OrgContext, path: string): Promise<{ folder: boolean; name: string; parent: string }> {
  if (isSystemPath(cleanFolder(path))) throw new UserFacingError("Esta pasta é da plataforma e não pode ser alterada.");
  if (isDashboardsPath(cleanFolder(path))) {
    throw new UserFacingError("Os dados publicados dos dashboards só mudam ao publicar de novo.");
  }
  const parent = parentOf(cleanFolder(path));
  const name = cleanFolder(path).slice(parent ? parent.length + 1 : 0);
  const list = await listing(ctx.org.slug, parent);
  if (list.folders.some((f) => f.replace(/\/$/, "") === name)) return { folder: true, name, parent };
  if (visibleFiles(list.files).some((f) => f.name === name)) return { folder: false, name, parent };
  throw new UserFacingError(`Não encontrado: ${path}`);
}

async function taken(ctx: OrgContext, folder: string, name: string): Promise<boolean> {
  const list = await listing(ctx.org.slug, folder);
  return list.folders.some((f) => f.replace(/\/$/, "") === name) || list.files.some((f) => f.name === name);
}

/** The analysis memory follows storage changes, but a failure there must not report a done move as failed. */
async function keepTrack(work: Promise<void>): Promise<void> {
  await work.catch((err: unknown) => console.error("[org-storage] analysis bookkeeping failed", err));
}

/** Every sub-folder under a folder (all levels), relative to it: ["2026", "2026/julho"]. */
async function subFolders(orgSlug: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const f of (await listing(orgSlug, joinPath(folder, rel))).folders) {
      const child = joinPath(rel, f.replace(/\/$/, ""));
      out.push(child);
      await walk(child);
    }
  };
  await walk("");
  return out;
}

/** Moves one item to `target/newName` (copy, then delete; folders with everything inside). */
async function relocate(ctx: OrgContext, from: { path: string; folder: boolean }, target: string, newName: string): Promise<string> {
  if (await taken(ctx, target, newName)) throw new UserFacingError(`Já existe "${newName}" em ${target || "Início"}.`);
  const to = joinPath(target, newName);
  if (!from.folder) {
    const fromKey = `${browsePrefix(ctx.org.slug, parentOf(from.path))}${from.path.split("/").pop()}`;
    const toKey = `${browsePrefix(ctx.org.slug, target)}${newName}`;
    await storage.move(fromKey, toKey);
    await keepTrack(moveAnalyses(ctx.org.id, fromKey, toKey)); // what the explorer learned about the file goes along
    return to;
  }
  const fromPrefix = browsePrefix(ctx.org.slug, from.path);
  const total = (await storage.listAll(fromPrefix)).length;
  // The folder and its sub-folders first, so empty ones survive the move too.
  for (const sub of ["", ...(await subFolders(ctx.org.slug, from.path))]) {
    await storage.createFolder(browsePrefix(ctx.org.slug, joinPath(to, sub)));
  }
  const moved = await storage.moveFolder(fromPrefix, browsePrefix(ctx.org.slug, to));
  if (moved < total) throw new UserFacingError(`Só ${moved} de ${total} arquivos foram movidos; os demais ficaram em ${from.path}.`);
  await storage.removeFolder(fromPrefix); // only empty sub-folders are left at this point
  await keepTrack(moveAnalyses(ctx.org.id, fromPrefix, browsePrefix(ctx.org.slug, to)));
  return to;
}

export async function renameItem(ctx: OrgContext, path: string, wanted: string): Promise<{ path: string }> {
  const item = await find(ctx, path);
  if (item.folder && isProtectedFolder(cleanFolder(path))) throw new UserFacingError("Pastas de cliente mudam junto com o endereço do cliente.");
  const newName = item.folder ? safeFolderName(wanted) : renamedFileName(item.name, wanted);
  if (!newName) throw new UserFacingError("Nome inválido.");
  if (newName === item.name) return { path: cleanFolder(path) };
  return { path: await relocate(ctx, { path: cleanFolder(path), folder: item.folder }, item.parent, newName) };
}

async function eachItem(paths: readonly string[], run: (path: string) => Promise<void>): Promise<BatchResult> {
  const result: BatchResult = { done: [], failed: [] };
  for (const raw of paths) {
    const path = cleanFolder(raw);
    try {
      await run(path);
      result.done.push(path);
    } catch (err) {
      if (!(err instanceof UserFacingError) && !(err instanceof StorageKeyError)) console.error("[org-storage]", path, err);
      result.failed.push({ path, error: err instanceof UserFacingError ? err.message : "Não foi possível concluir." });
    }
  }
  return result;
}

export async function moveItems(ctx: OrgContext, paths: readonly string[], target: string): Promise<BatchResult> {
  const dest = cleanFolder(target);
  browsePrefix(ctx.org.slug, dest); // validates the target before touching anything
  await assertTarget(ctx.org, dest);
  return eachItem(paths, async (path) => {
    const item = await find(ctx, path);
    const reason = canMoveTo({ path, folder: item.folder }, dest);
    if (reason) throw new UserFacingError(reason);
    await relocate(ctx, { path, folder: item.folder }, dest, item.name);
  });
}

export async function removeItems(ctx: OrgContext, paths: readonly string[]): Promise<BatchResult> {
  return eachItem(paths, async (path) => {
    const item = await find(ctx, path);
    if (item.folder) {
      if (isProtectedFolder(path)) throw new UserFacingError("Pastas de cliente não podem ser excluídas aqui.");
      await storage.removeFolder(browsePrefix(ctx.org.slug, path));
      await keepTrack(forgetAnalyses(ctx.org.id, [browsePrefix(ctx.org.slug, path)]));
    } else {
      const key = `${browsePrefix(ctx.org.slug, item.parent)}${item.name}`;
      await storage.remove([key], true);
      await keepTrack(forgetAnalyses(ctx.org.id, [key]));
    }
  });
}
