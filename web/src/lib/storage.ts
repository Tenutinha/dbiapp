import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";

/** Local-disk layout (mirrors the bucket layout planned for Supabase Storage). */
export const storage = {
  root: env.storageRoot,
  incomingFile(ext: string): string {
    return path.join(env.storageRoot, "_incoming", `${randomUUID()}.${ext}`);
  },
  versionDir(organizationId: string, instanceId: string, version: number): string {
    return path.join(env.storageRoot, organizationId, instanceId, `v${version}`);
  },
};
