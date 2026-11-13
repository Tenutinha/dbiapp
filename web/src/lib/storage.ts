/**
 * File storage behind one interface:
 *  - local:    files live under DBI_STORAGE_DIR (development).
 *  - supabase / gcs: files live in a private cloud bucket (Supabase Storage or Google Cloud
 *              Storage); reads are downloaded once into a local cache (keys are immutable — every
 *              upload gets a new key), so DuckDB keeps reading plain local files inside its sandbox.
 *
 * Keys are relative and grouped by organization — see storage-keys.ts for the layout.
 * Older local rows may hold absolute paths; those are still accepted by the local driver.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gcsBucket } from "./blob/gcs";
import { supabaseBucket } from "./blob/supabase";
import type { RemoteBucket } from "./blob/types";
import { env } from "./env";
import * as keys from "./storage-keys";
import { assertKey, StorageKeyError } from "./storage-keys";
import { browsePrefix, type BrowseEntryFile, type FolderListing } from "./storage-browse";

export { StorageKeyError };

/** Where a key lives on this machine (the file itself for local, the cache copy for Supabase). */
function workPath(key: string): string {
  if (env.DBI_STORAGE_DRIVER === "local" && path.isAbsolute(key)) return key; // legacy rows
  assertKey(key);
  const p = path.resolve(env.workRoot, ...key.split("/"));
  if (!p.startsWith(path.resolve(env.workRoot) + path.sep)) throw new StorageKeyError(`key escapes storage: ${key}`);
  return p;
}

let remoteBucket: RemoteBucket | null = null;
function bucket(): RemoteBucket {
  remoteBucket ??=
    env.DBI_STORAGE_DRIVER === "gcs"
      ? gcsBucket({
          bucket: env.GCS_BUCKET as string,
          projectId: env.GCS_PROJECT_ID,
          credentialsBase64: env.GCS_CREDENTIALS_BASE64,
          keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
        })
      : supabaseBucket(
          env.NEXT_PUBLIC_SUPABASE_URL as string,
          env.SUPABASE_SERVICE_ROLE_KEY as string,
          env.DBI_STORAGE_BUCKET,
        );
  return remoteBucket;
}

const isRemote = (): boolean => env.DBI_STORAGE_DRIVER !== "local";

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

export interface UploadTarget {
  key: string;
  /** Pre-signed URL the browser PUTs the file to (cloud drivers only). */
  signedUrl: string;
}

export const storage = {
  /** DuckDB sandbox root. */
  get workRoot(): string {
    return env.workRoot;
  },
  remote: isRemote,

  datasetKey: keys.datasetKey,
  uploadKey: keys.uploadKey,
  brandingKey: keys.brandingKey,

  /**
   * Creates the organization's folder (orgs/<slug>/) so it shows up right away in the bucket.
   * Never throws: a missing folder must not fail the signup — files create it anyway.
   */
  async createOrgFolder(orgSlug: string): Promise<void> {
    try {
      const folder = keys.orgFolder(orgSlug);
      if (isRemote()) await bucket().createFolder(folder);
      else await mkdir(path.resolve(env.workRoot, folder), { recursive: true });
    } catch (err) {
      console.error("[storage] could not create folder for organization", orgSlug, err);
    }
  },

  /** Creates a client's folder (orgs/<org>/clientes/<cliente>/). Never throws, like createOrgFolder. */
  async createClientFolder(orgSlug: string, clientSlug: string): Promise<void> {
    try {
      const folder = keys.clientFolder(orgSlug, clientSlug);
      if (isRemote()) await bucket().createFolder(folder);
      else await mkdir(path.resolve(env.workRoot, folder), { recursive: true });
    } catch (err) {
      console.error("[storage] could not create folder for client", orgSlug, clientSlug, err);
    }
  },

  /** Creates an empty folder (a prefix ending with "/"); succeeds if it already exists. */
  async createFolder(prefix: string): Promise<void> {
    assertKey(prefix.replace(/\/$/, ""));
    const folder = prefix.endsWith("/") ? prefix : `${prefix}/`;
    if (isRemote()) await bucket().createFolder(folder);
    else await mkdir(path.resolve(env.workRoot, ...folder.split("/").filter(Boolean)), { recursive: true });
  },

  /** Deletes a folder and everything under it (objects, folder markers, local copies). Returns how many objects went. */
  async removeFolder(prefix: string): Promise<number> {
    assertKey(prefix.replace(/\/$/, ""));
    const folder = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const objects = await this.listAll(folder);
    if (isRemote()) {
      // Folder markers of every sub-folder too, or empty "ghost" folders would stay behind.
      const markers: string[] = [];
      const walk = async (p: string): Promise<void> => {
        markers.push(p, `${p}.emptyFolderPlaceholder`);
        for (const f of (await bucket().list(p, 10_000)).folders) await walk(`${p}${f}/`);
      };
      await walk(folder);
      if (objects.length > 0) await bucket().remove(objects, true); // throws: never claim a folder is gone when it is not
      await bucket().remove(markers);
    }
    await rm(path.resolve(env.workRoot, ...folder.split("/").filter(Boolean)), { recursive: true, force: true }).catch(() => undefined);
    return objects.length;
  },

  /**
   * Every file under a prefix (all levels) with its size and date; `names` keeps only those file names.
   * One paginated listing on Google Cloud Storage; elsewhere, one listing per folder.
   */
  async listTree(prefix: string, names?: readonly string[]): Promise<BrowseEntryFile[]> {
    assertKey(prefix.replace(/\/$/, ""));
    const folder = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const keep = (name: string): boolean => !names || names.includes(name);
    if (isRemote()) {
      const remote = bucket();
      if (remote.listTree) return remote.listTree(folder, names);
      const out: BrowseEntryFile[] = [];
      const walk = async (p: string): Promise<void> => {
        const level = await remote.list(p, 10_000);
        out.push(...level.files.filter((f) => !f.name.endsWith(".emptyFolderPlaceholder") && keep(f.name)));
        await Promise.all(level.folders.map((f) => walk(`${p}${f}/`)));
      };
      await walk(folder);
      return out;
    }
    const out: BrowseEntryFile[] = [];
    const walk = async (p: string): Promise<void> => {
      const dir = path.resolve(env.workRoot, ...p.split("/").filter(Boolean));
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(`${p}${e.name}/`);
        else if (!e.name.endsWith(".part") && keep(e.name)) {
          const info = await stat(path.join(dir, e.name));
          out.push({ key: `${p}${e.name}`, name: e.name, sizeBytes: info.size, updatedAt: info.mtime });
        }
      }
    };
    await walk(folder);
    return out;
  },

  /** Every object under a prefix (all levels), as keys. */
  async listAll(prefix: string): Promise<string[]> {
    assertKey(prefix.replace(/\/$/, ""));
    const out: string[] = [];
    const walk = async (p: string): Promise<void> => {
      if (isRemote()) {
        const level = await bucket().list(p, 10_000);
        out.push(...level.files.map((f) => f.key).filter((k) => !k.endsWith("/") && !k.endsWith(".emptyFolderPlaceholder")));
        for (const f of level.folders) await walk(`${p}${f}/`);
        return;
      }
      const dir = path.resolve(env.workRoot, ...p.split("/").filter(Boolean));
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(`${p}${e.name}/`);
        else if (!e.name.endsWith(".part")) out.push(`${p}${e.name}`);
      }
    };
    await walk(prefix.endsWith("/") ? prefix : `${prefix}/`);
    return out;
  },

  /**
   * Moves every object of a folder to another folder (copy, then delete). Used when a client's address
   * changes. Objects already present at the target are left alone (the source copy is kept then).
   * Returns how many objects moved.
   */
  async moveFolder(fromPrefix: string, toPrefix: string): Promise<number> {
    assertKey(fromPrefix.replace(/\/$/, ""));
    assertKey(toPrefix.replace(/\/$/, ""));
    const objects = await this.listAll(fromPrefix);
    let moved = 0;
    for (const key of objects) {
      const target = `${toPrefix}${key.slice(fromPrefix.length)}`;
      try {
        if (isRemote()) await bucket().copy(key, target);
        else {
          await mkdir(path.dirname(workPath(target)), { recursive: true });
          if (await exists(workPath(target))) throw new Error("target exists");
          await rename(workPath(key), workPath(target));
        }
        if (isRemote()) await bucket().remove([key]);
        await rm(workPath(key), { force: true }).catch(() => undefined);
        moved += 1;
      } catch (err) {
        console.error("[storage] could not move", key, "to", target, err);
      }
    }
    if (isRemote()) {
      await bucket().createFolder(toPrefix).catch(() => undefined);
      await bucket().remove([fromPrefix, `${fromPrefix}.emptyFolderPlaceholder`]);
    } else if (moved === objects.length) {
      // Only empty directories are left behind; never drop a file that failed to move.
      await rm(path.resolve(env.workRoot, ...fromPrefix.split("/").filter(Boolean)), { recursive: true, force: true }).catch(() => undefined);
    }
    return moved;
  },

  /** Local path to write a new object to before `commit`. */
  pathFor(key: string): string {
    return workPath(key);
  },

  /** Makes a file written at pathFor(key) durable (uploads it to the bucket; no-op on local disk). */
  async commit(key: string, contentType: string): Promise<void> {
    if (!isRemote()) return;
    await bucket().upload(key, new Uint8Array(await readFile(workPath(key))), contentType);
  },

  async putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = workPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await this.commit(key, contentType);
  },

  /** Local path with the object's content, downloading it into the cache if needed. */
  async localPath(key: string): Promise<string> {
    const file = workPath(key);
    if (!isRemote() || (await exists(file))) return file;
    const data = await bucket().download(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.part`;
    await writeFile(tmp, data);
    await rename(tmp, file);
    return file;
  },

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.localPath(key)));
  },

  /**
   * An object as it is in the bucket now, never from this machine's cache: for the small records that are
   * written again at the same key (a parts marker, a failure record, a lineage).
   */
  async readFresh(key: string): Promise<Uint8Array> {
    if (isRemote()) {
      assertKey(key);
      return bucket().download(key);
    }
    return new Uint8Array(await readFile(workPath(key)));
  },

  /** Writes a small record at a key that may already hold an older one (objects are never overwritten in the bucket). */
  async replaceBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.remove([key]);
    await this.putBytes(key, bytes, contentType);
  },

  /** The first `bytes` of an object, without downloading it whole. */
  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    const file = workPath(key);
    if (isRemote() && !(await exists(file))) return bucket().downloadHead(key, bytes);
    const handle = await open(file, "r");
    try {
      const buffer = new Uint8Array(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },

  /** Moves one object to a new key (copy, then delete); the target must not exist. */
  async move(fromKey: string, toKey: string): Promise<void> {
    assertKey(fromKey);
    assertKey(toKey);
    if (isRemote()) {
      await bucket().copy(fromKey, toKey);
      await bucket().remove([fromKey]);
      await rm(workPath(fromKey), { force: true }).catch(() => undefined);
      return;
    }
    if (await exists(workPath(toKey))) throw new Error(`storage move: ${toKey} already exists`);
    await mkdir(path.dirname(workPath(toKey)), { recursive: true });
    await rename(workPath(fromKey), workPath(toKey));
  },

  /**
   * Deletes objects (remote + local copy). Never throws by default: cleanup must not break the request.
   * strict: throws when the bucket could not delete something (user-asked deletions).
   */
  async remove(list: readonly string[], strict = false): Promise<void> {
    const valid = list.filter((k) => (path.isAbsolute(k) && !isRemote()) || keys.isValidKey(k));
    await Promise.all(valid.map((k) => rm(workPath(k), { force: true }).catch(() => undefined)));
    if (strict && valid.length < list.length) throw new StorageKeyError("invalid key in remove");
    if (isRemote() && valid.length > 0) await bucket().remove(valid, strict);
  },

  /**
   * Read-only listing of one level of an organization's folder (`subPath` relative to
   * orgs/<slug>/, validated so it can never leave it).
   */
  async listOrgFolder(orgSlug: string, subPath: string | undefined, limit = 500): Promise<FolderListing> {
    const prefix = browsePrefix(orgSlug, subPath);
    if (isRemote()) return bucket().list(prefix, limit);

    const dir = path.resolve(env.workRoot, ...prefix.split("/").filter(Boolean));
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const fileEntries = entries.filter((e) => e.isFile() && !e.name.endsWith(".part"));
    const files = await Promise.all(
      fileEntries.slice(0, limit).map(async (e) => {
        const info = await stat(path.join(dir, e.name));
        return { key: `${prefix}${e.name}`, name: e.name, sizeBytes: info.size, updatedAt: info.mtime };
      }),
    );
    return {
      folders: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      truncated: fileEntries.length > limit,
    };
  },

  /** Lets the browser upload straight to the bucket (skips the ~4.5 MB serverless body limit). */
  async createUploadTarget(key: string): Promise<UploadTarget | null> {
    if (!isRemote()) return null;
    assertKey(key);
    return { key, signedUrl: await bucket().signedUploadUrl(key) };
  },
};
