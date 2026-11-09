import type { FolderListing } from "../storage-browse";

/** A private object bucket in the cloud. Keys are already validated by `storage.ts`. */
export interface RemoteBucket {
  /** One level of a folder: its sub-folders and files (at most `limit` files). */
  list(prefix: string, limit: number): Promise<FolderListing>;
  upload(key: string, body: Uint8Array, contentType: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  /** Best effort: logs and swallows errors (cleanup must not break the request). */
  remove(keys: readonly string[]): Promise<void>;
  /** URL the browser PUTs the file to, valid for a short time. */
  signedUploadUrl(key: string): Promise<string>;
  /** Creates an empty folder marker (e.g. "orgs/acme/"); succeeds if it already exists. */
  createFolder(prefix: string): Promise<void>;
  /** Copies one object to a new key (fails if the target exists). */
  copy(fromKey: string, toKey: string): Promise<void>;
}
