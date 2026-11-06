import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { RemoteBucket } from "./types";

export function supabaseBucket(url: string, serviceRoleKey: string, bucketName: string): RemoteBucket {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = () => client.storage.from(bucketName);

  return {
    async upload(key, body, contentType) {
      const { error } = await bucket().upload(key, body, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed for ${key}: ${error.message}`);
    },
    async download(key) {
      const { data, error } = await bucket().download(key);
      if (error || !data) throw new Error(`storage download failed for ${key}: ${error?.message ?? "no data"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(keys) {
      const { error } = await bucket().remove([...keys]);
      if (error) console.error("[storage] remove failed", error.message);
    },
    async signedUploadUrl(key) {
      const { data, error } = await bucket().createSignedUploadUrl(key);
      if (error || !data) throw new Error(`could not create upload URL: ${error?.message ?? "no data"}`);
      return data.signedUrl;
    },
    async createFolder(prefix) {
      // Supabase Storage has no empty folders; its dashboard uses this placeholder file.
      const { error } = await bucket().upload(`${prefix}.emptyFolderPlaceholder`, new Uint8Array(), { upsert: true });
      if (error) throw new Error(`could not create folder ${prefix}: ${error.message}`);
    },
  };
}
