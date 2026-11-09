import "server-only";
import { Storage, type StorageOptions } from "@google-cloud/storage";
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
    async download(key) {
      try {
        const [buf] = await bucket.file(key).download();
        return new Uint8Array(buf);
      } catch (e) {
        throw new Error(`storage download failed for ${key}: ${errMsg(e)}`);
      }
    },
    async remove(keys) {
      const results = await Promise.allSettled(keys.map((k) => bucket.file(k).delete({ ignoreNotFound: true })));
      for (const r of results) if (r.status === "rejected") console.error("[storage] remove failed", errMsg(r.reason));
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
