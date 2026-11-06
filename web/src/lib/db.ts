import "server-only";
import postgres from "postgres";
import { env } from "./env";

type Sql = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { __dbiSql?: Sql };

/**
 * Supabase's transaction pooler (port 6543, used from serverless) does not support
 * prepared statements, and each serverless instance should hold few connections.
 */
function connect(): Sql {
  const url = new URL(env.DATABASE_URL);
  const pooled = url.port === "6543";
  return postgres(env.DATABASE_URL, {
    max: pooled ? 3 : 10,
    prepare: !pooled,
    ssl: url.hostname === "localhost" || url.hostname === "127.0.0.1" ? false : "require",
    idle_timeout: pooled ? 20 : undefined,
  });
}

/** Single pooled client, reused across dev hot reloads and warm serverless invocations. */
function client(): Sql {
  globalForDb.__dbiSql ??= connect();
  return globalForDb.__dbiSql;
}

/**
 * Connects on first query, not at import, so `next build` never needs DATABASE_URL.
 * Behaves exactly like the postgres.js client: tagged templates, sql.begin, sql.json, …
 */
export const sql: Sql = new Proxy(function lazySql() {} as unknown as Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, key) {
    const real = client() as unknown as Record<PropertyKey, unknown>;
    const value = real[key];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
