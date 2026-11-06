import "server-only";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DBI_STORAGE_DIR: z.string().min(1).default("./storage"),
  DBI_DEMO_USER_EMAIL: z.string().email(),
  DBI_DEV_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

function load(): z.output<typeof envSchema> & { storageRoot: string } {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment (${missing}). Copy .env.example to .env.local.`);
  }
  return { ...parsed.data, storageRoot: path.resolve(process.cwd(), parsed.data.DBI_STORAGE_DIR) };
}

export const env = load();
