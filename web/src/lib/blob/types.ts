import type { BrowseEntryFile, FolderListing } from "../storage-browse";

/** A private object bucket in the cloud. Keys are already validated by `storage.ts`. */
export interface RemoteBucket {
  /** One level of a folder: its sub-folders and files (at most `limit` files). */
  list(prefix: string, limit: number): Promise<FolderListing>;
  /**
   * Every object under a prefix, all levels, in one paginated listing (no per-folder round trips).
   * `names`: only objects with one of these file names (filtered by the bucket when it can).
   * Optional: without it the storage walks the folders one level at a time.
   */
  listTree?(prefix: string, names?: readonly string[]): Promise<BrowseEntryFile[]>;
  upload(key: string, body: Uint8Array, contentType: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  /** The first `bytes` of an object (to identify a big file without fetching it whole). */
  downloadHead(key: string, bytes: number): Promise<Uint8Array>;
  /**
   * Best effort by default: logs and swallows errors (cleanup must not break the request).
   * With strict, throws when any object could not be deleted (the explorer must not report a false success).
   */
  remove(keys: readonly string[], strict?: boolean): Promise<void>;
  /** URL the browser PUTs the file to, valid for a short time. */
  signedUploadUrl(key: string): Promise<string>;
  /** Creates an empty folder marker (e.g. "orgs/acme/"); succeeds if it already exists. */
  createFolder(prefix: string): Promise<void>;
  /** Copies one object to a new key (fails if the target exists). */
  copy(fromKey: string, toKey: string): Promise<void>;
}
