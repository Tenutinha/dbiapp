/** A private object bucket in the cloud. Keys are already validated by `storage.ts`. */
export interface RemoteBucket {
  upload(key: string, body: Uint8Array, contentType: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  /** Best effort: logs and swallows errors (cleanup must not break the request). */
  remove(keys: readonly string[]): Promise<void>;
  /** URL the browser PUTs the file to, valid for a short time. */
  signedUploadUrl(key: string): Promise<string>;
}
