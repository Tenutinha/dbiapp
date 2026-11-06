/**
 * File storage behind one interface:
 *  - local:    files live under DBI_STORAGE_DIR (development).
 *  - supabase / gcs: files live in a private cloud bucket (Supabase Storage or Google Cloud
 *              Storage); reads are downloaded once into a local cache (keys are immutable — every
 *              upload gets a new key), so DuckDB keeps reading plain local files inside its sandbox.
 *
 * Keys are relative, e.g. "datasets/<org>/<dashboard>/v3/fato_vendas.ab12cd34.parquet".
 * Older local rows may hold absolute paths; those are still accepted by the local driver.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gcsBucket } from "./blob/gcs";
import { supabaseBucket } from "./blob/supabase";
import type { RemoteBucket } from "./blob/types";
import { env } from "./env";

const KEY = /^(datasets|incoming|branding)\/[A-Za-z0-9._/-]+$/;

export class StorageKeyError extends Error {}

function assertKey(key: string): void {
  if (!KEY.test(key) || key.includes("..") || key.includes("//")) throw new StorageKeyError(`invalid storage key: ${key}`);
}

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

  datasetKey(orgId: string, instanceId: string, version: number, table: string): string {
    return `datasets/${orgId}/${instanceId}/v${version}/${table}.${randomUUID().slice(0, 8)}.parquet`;
  },
  incomingKey(instanceId: string, ext: string): string {
    return `incoming/${instanceId}/${randomUUID()}.${ext}`;
  },
  brandingKey(orgId: string, id: string, ext: string): string {
    return `branding/${orgId}/${id}.${ext}`;
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

  /** Deletes objects (remote + local copy). Never throws: cleanup must not break the request. */
  async remove(keys: readonly string[]): Promise<void> {
    const valid = keys.filter((k) => (path.isAbsolute(k) && !isRemote()) || KEY.test(k));
    await Promise.all(valid.map((k) => rm(workPath(k), { force: true }).catch(() => undefined)));
    if (isRemote() && valid.length > 0) await bucket().remove(valid);
  },

  /** Lets the browser upload straight to the bucket (skips the ~4.5 MB serverless body limit). */
  async createUploadTarget(key: string): Promise<UploadTarget | null> {
    if (!isRemote()) return null;
    assertKey(key);
    return { key, signedUrl: await bucket().signedUploadUrl(key) };
  },
};
