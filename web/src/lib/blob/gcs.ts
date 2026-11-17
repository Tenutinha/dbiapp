import "server-only";
import { Storage, type StorageOptions } from "@google-cloud/storage";
import type { BrowseEntryFile } from "../storage-browse";
import type { RemoteBucket } from "./types";

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export interface GcsConfig {
  bucket: string;
  projectId?: string;
  /** Service-account key JSON, base64-encoded (for hosts without a key file, e.g. Vercel). */
  credentialsBase64?: string;
  /** Path to a service-account key file (local development). */
  keyFile?: string;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function parseKey(b64: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("GCS_CREDENTIALS_BASE64 is not base64-encoded JSON");
  }
  const k = parsed as Partial<ServiceAccountKey>;
  if (typeof k.client_email !== "string" || typeof k.private_key !== "string") {
    throw new Error("GCS_CREDENTIALS_BASE64 is not a service-account key (client_email/private_key missing)");
  }
  return { client_email: k.client_email, private_key: k.private_key, project_id: k.project_id };
}

function options(cfg: GcsConfig): StorageOptions {
  if (cfg.credentialsBase64) {
    const key = parseKey(cfg.credentialsBase64);
    return {
      projectId: cfg.projectId ?? key.project_id,
      credentials: { client_email: key.client_email, private_key: key.private_key },
    };
  }
  // Key file, or Application Default Credentials (signed upload URLs need a service account).
  return { projectId: cfg.projectId, keyFilename: cfg.keyFile };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a listing of a whole tree asks of each object: nothing else travels (a full record is ~1 kB, times thousands). */
const TREE_FIELDS = "items(name,size,updated),prefixes,nextPageToken";
/** An object as such a listing answers it: with `fields`, the library hands the bucket's record as it came. */
interface TreeRecord {
  name: string;
  size?: string | number;
  updated?: string;
}
/** Sub-folders of a tree listed at the same time. */
const FOLDERS_AT_A_TIME = 24;
/** A tree with more first-level entries than this is listed in one go (its pages one after the other). */
const MAX_FIRST_LEVEL = 1000;

/** The files among the records of a listing (folder markers left out), kept to `names` when given. */
function asEntries(records: readonly TreeRecord[], names?: readonly string[]): BrowseEntryFile[] {
  return records
    .filter((f) => !f.name.endsWith("/") && !f.name.endsWith(".emptyFolderPlaceholder"))
    .map((f) => ({
      key: f.name,
      name: f.name.slice(f.name.lastIndexOf("/") + 1),
      sizeBytes: Number(f.size ?? 0),
      updatedAt: f.updated ? new Date(f.updated) : null,
    }))
    .filter((f) => !names || names.includes(f.name));
}

/** `fn` over every item, a few at a time, results in the order of the items. */
async function pooled<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]);
  }));
  return results;
}

export function gcsBucket(cfg: GcsConfig): RemoteBucket {
  const bucket = new Storage(options(cfg)).bucket(cfg.bucket);

  return {
    async list(prefix, limit) {
      try {
        const [files, nextQuery, response] = await bucket.getFiles({
          prefix,
          delimiter: "/",
          autoPaginate: false,
          maxResults: limit,
        });
        const prefixes = ((response as { prefixes?: string[] } | undefined)?.prefixes ?? []).map((p) =>
          p.slice(prefix.length).replace(/\/$/, ""),
        );
        return {
          folders: prefixes.filter((p) => p !== ""),
          files: files
            .filter((f) => f.name !== prefix) // the folder's own marker object
            .map((f) => ({
              key: f.name,
              name: f.name.slice(prefix.length),
              sizeBytes: Number(f.metadata.size ?? 0),
              updatedAt: f.metadata.updated ? new Date(f.metadata.updated) : null,
            })),
          truncated: Boolean(nextQuery),
        };
      } catch (e) {
        throw new Error(`storage list failed for ${prefix}: ${errMsg(e)}`);
      }
    },
    async listTree(prefix, names) {
      try {
        // matchGlob: the bucket itself keeps only the named files (thousands of parts folders, two names wanted).
        const wanted = names && names.length > 0 ? `**/${names.length === 1 ? names[0] : `{${names.join(",")}}`}` : undefined;
        const under = async (folder: string): Promise<TreeRecord[]> => {
          const [found] = await bucket.getFiles({
            prefix: folder, autoPaginate: true, fields: TREE_FIELDS, ...(wanted ? { matchGlob: `${folder}${wanted}` } : {}),
          });
          return found as unknown as TreeRecord[];
        };
        // Named files: one listing, the bucket skips the rest itself.
        if (wanted) {
          const named = await under(prefix);
          return asEntries(named, names);
        }
        // Everything: a listing comes a page (a thousand objects) at a time, one page after the other, and ten
        // thousand files took ten round trips in a row. The first-level folders (one per company) are listed
        // side by side instead.
        const [top, more, response] = await bucket.getFiles({
          prefix, delimiter: "/", autoPaginate: false, maxResults: MAX_FIRST_LEVEL, fields: TREE_FIELDS,
        });
        const folders = (response as { prefixes?: string[] } | undefined)?.prefixes ?? [];
        const files = more || folders.length < 2
          ? await under(prefix)
          : [...(top as unknown as TreeRecord[]), ...(await pooled(folders, FOLDERS_AT_A_TIME, under)).flat()];
        return asEntries(files, names);
      } catch (e) {
        throw new Error(`storage list failed for ${prefix}: ${errMsg(e)}`);
      }
    },
    async upload(key, body, contentType) {
      try {
        // ifGenerationMatch 0 = only create, never overwrite (keys are immutable).
        await bucket.file(key).save(Buffer.from(body), {
          contentType,
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
        });
      } catch (e) {
        throw new Error(`storage upload failed for ${key}: ${errMsg(e)}`);
      }
    },
    async uploadFile(key, localPath, contentType) {
      try {
        await bucket.upload(localPath, {
          destination: key, contentType, resumable: true, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 },
        });
      } catch (e) {
        throw new Error(`storage upload failed for ${key}: ${errMsg(e)}`);
      }
    },
    async download(key) {
      try {
        const [buf] = await bucket.file(key).download();
        return new Uint8Array(buf);
      } catch (e) {
        throw new Error(`storage download failed for ${key}: ${errMsg(e)}`);
      }
    },
    async downloadHead(key, bytes) {
      try {
        const [buf] = await bucket.file(key).download({ start: 0, end: bytes - 1 });
        return new Uint8Array(buf);
      } catch (e) {
        throw new Error(`storage download failed for ${key}: ${errMsg(e)}`);
      }
    },
    async md5(key) {
      try {
        const [meta] = await bucket.file(key).getMetadata();
        return typeof meta.md5Hash === "string" ? Buffer.from(meta.md5Hash, "base64").toString("hex") : null;
      } catch (e) {
        throw new Error(`storage metadata failed for ${key}: ${errMsg(e)}`);
      }
    },
    async remove(keys, strict) {
      const results = await Promise.allSettled(keys.map((k) => bucket.file(k).delete({ ignoreNotFound: true })));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      for (const r of failed) console.error("[storage] remove failed", errMsg(r.reason));
      if (strict && failed.length > 0) throw new Error(`storage remove failed for ${failed.length} object(s): ${errMsg(failed[0].reason)}`);
    },
    async signedUploadUrl(key) {
      try {
        const [url] = await bucket.file(key).getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + UPLOAD_URL_TTL_MS,
        });
        return url;
      } catch (e) {
        throw new Error(`could not create upload URL: ${errMsg(e)}`);
      }
    },
    async copy(fromKey, toKey) {
      try {
        await bucket.file(fromKey).copy(bucket.file(toKey), { preconditionOpts: { ifGenerationMatch: 0 } });
      } catch (e) {
        throw new Error(`storage copy failed for ${fromKey}: ${errMsg(e)}`);
      }
    },
    async createFolder(prefix) {
      try {
        // Zero-byte object ending in "/": what the Cloud Console itself creates for a folder.
        await bucket.file(prefix).save("", { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
      } catch (e) {
        if ((e as { code?: number }).code === 412) return; // already exists
        throw new Error(`could not create folder ${prefix}: ${errMsg(e)}`);
      }
    },
  };
}
