/**
 * Where the parts of a fiscal dashboard (one small Parquet per table per raw file, and their markers) live.
 *
 *  - by default, in the storage like everything else (the hosted app reads file by file and puts the tables
 *    together from the bucket);
 *  - with DBI_FISCAL_LOCAL_PARTS=1, only on this machine, under the work folder (DBI_WORK_DIR): the machine
 *    that prepares the data reads the originals from its own disk, keeps the parts there and sends only the
 *    finished tables. Nothing is downloaded to put a table together. Never on the hosted app: its disk is
 *    temporary.
 *
 * Same keys in both cases (<dashboard>/partes/<cnpj>/<aaaa-mm>/<id>/<file>), so the plan does not change.
 */
import "server-only";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { storage } from "../storage";
import type { BrowseEntryFile } from "../storage-browse";

/** Whether the parts stay on this machine only. */
export function localParts(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const flag = env.DBI_FISCAL_LOCAL_PARTS?.trim().toLowerCase();
  return (flag === "1" || flag === "true") && !env.VERCEL;
}

/** Whether a key is one of a dashboard's parts (the rest of what a table is made from is in the storage). */
export const isPartKey = (key: string): boolean => /\/dashboards\/[^/]+\/partes\//.test(key);

const folderPath = (prefix: string): string => storage.pathFor(prefix.replace(/\/$/, ""));

async function walk(prefix: string, names: readonly string[] | undefined, out: BrowseEntryFile[]): Promise<void> {
  const dir = folderPath(prefix);
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) await walk(`${prefix}${e.name}/`, names, out);
    else if (!e.name.endsWith(".part") && (!names || names.includes(e.name))) {
      const info = await stat(path.join(dir, e.name));
      out.push({ key: `${prefix}${e.name}`, name: e.name, sizeBytes: info.size, updatedAt: info.mtime });
    }
  }
}

export const partsStore = {
  local: localParts,

  /** Local path a part is written to before `commit`. */
  pathFor: (key: string): string => storage.pathFor(key),

  /** Makes a part written at pathFor(key) durable: uploaded, or already where it stays. */
  async commit(key: string, contentType: string): Promise<void> {
    if (!localParts()) await storage.commit(key, contentType);
  },

  /** Local path with the part's content (downloaded when the parts are in the storage). */
  async localPath(key: string): Promise<string> {
    return localParts() ? storage.pathFor(key) : storage.localPath(key);
  },

  /** A small record (marker, failure) as it is now. */
  async readFresh(key: string): Promise<Uint8Array> {
    return localParts() ? new Uint8Array(await readFile(storage.pathFor(key))) : storage.readFresh(key);
  },

  /** Writes a small record at a key that may already hold an older one. */
  async replaceBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (!localParts()) return storage.replaceBytes(key, bytes, contentType);
    const file = storage.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },

  /** Every file under a prefix (all levels); `names` keeps only those file names. */
  async listTree(prefix: string, names?: readonly string[]): Promise<BrowseEntryFile[]> {
    if (!localParts()) return storage.listTree(prefix, names);
    const out: BrowseEntryFile[] = [];
    await walk(prefix.endsWith("/") ? prefix : `${prefix}/`, names, out);
    return out;
  },

  /** Deletes a parts folder and everything under it. */
  async removeFolder(prefix: string): Promise<void> {
    if (!localParts()) {
      await storage.removeFolder(prefix);
      return;
    }
    await rm(folderPath(prefix), { recursive: true, force: true });
  },
};
