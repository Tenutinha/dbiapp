import "server-only";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    DBI_DEMO_USER_EMAIL: z.string().email().optional(),
    DBI_DEV_AUTH: bool,

    /** "dev" = "entrar como" switcher (never in production); "supabase" = Supabase Auth (password + e-mail link). */
    DBI_AUTH: z.enum(["dev", "supabase"]).default("dev"),
    /** "local" = this machine's disk; "supabase" = private Supabase Storage bucket; "gcs" = Google Cloud Storage. */
    DBI_STORAGE_DRIVER: z.enum(["local", "supabase", "gcs"]).default("local"),
    DBI_STORAGE_DIR: z.string().min(1).default("./storage"),
    DBI_STORAGE_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default("dbi"),

    /** Google Cloud Storage (DBI_STORAGE_DRIVER=gcs). */
    GCS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/).optional(),
    GCS_PROJECT_ID: z.string().min(1).optional(),
    /** Server-only. Service-account key JSON, base64-encoded (Vercel). */
    GCS_CREDENTIALS_BASE64: z.string().min(20).optional(),
    /** Server-only. Path to a service-account key file (local development). */
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),

    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
    /** Server-only. Used for Storage; never sent to the browser. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  })
  .superRefine((e, ctx) => {
    const need = (key: keyof typeof e, why: string): void => {
      if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `required when ${why}` });
    };
    if (e.DBI_AUTH === "supabase") {
      need("NEXT_PUBLIC_SUPABASE_URL", "DBI_AUTH=supabase");
      need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DBI_AUTH=supabase");
    }
    if (e.DBI_STORAGE_DRIVER === "supabase") {
      need("NEXT_PUBLIC_SUPABASE_URL", "DBI_STORAGE_DRIVER=supabase");
      need("SUPABASE_SERVICE_ROLE_KEY", "DBI_STORAGE_DRIVER=supabase");
    }
    if (e.DBI_STORAGE_DRIVER === "gcs") {
      need("GCS_BUCKET", "DBI_STORAGE_DRIVER=gcs");
      if (!e.GCS_CREDENTIALS_BASE64 && !e.GOOGLE_APPLICATION_CREDENTIALS) {
        ctx.addIssue({
          code: "custom",
          path: ["GCS_CREDENTIALS_BASE64"],
          message: "GCS_CREDENTIALS_BASE64 or GOOGLE_APPLICATION_CREDENTIALS required when DBI_STORAGE_DRIVER=gcs",
        });
      }
    }
    if (e.DBI_AUTH === "dev") need("DBI_DEMO_USER_EMAIL", "DBI_AUTH=dev");
  });

export type Env = z.output<typeof envSchema> & {
  /** Directory DuckDB may touch: the storage itself (local) or a download cache (Supabase). */
  workRoot: string;
};

function load(): Env {
  // Values pasted or piped into a host's dashboard/CLI often carry a trailing newline ("gcs\n"),
  // which would fail enum/regex checks and take the whole app down. Trim before validating.
  const trimmed = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v?.trim()]));
  const parsed = envSchema.safeParse(trimmed);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment (${issues}). See .env.example.`);
  }
  const e = parsed.data;
  const workRoot =
    e.DBI_STORAGE_DRIVER === "local"
      ? path.resolve(process.cwd(), e.DBI_STORAGE_DIR)
      : path.join(os.tmpdir(), "dbi-cache");
  return { ...e, workRoot };
}

let cached: Env | null = null;

/**
 * Validated on first use, not at import: `next build` imports server modules to collect page
 * data, and builds (e.g. PR previews) must not need runtime secrets such as DATABASE_URL.
 * A missing variable still fails loudly — on the first request that needs it.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, key) {
    cached ??= load();
    return cached[key as keyof Env];
  },
});
