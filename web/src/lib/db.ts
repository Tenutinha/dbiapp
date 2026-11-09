import "server-only";
import postgres from "postgres";
import { env } from "./env";

type Sql = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { __dbiSql?: Sql };

/**
 * Supabase's transaction pooler (port 6543, used from serverless — production must use it: the direct
 * host is IPv6-only) does not support prepared statements, and each serverless instance should hold few
 * connections. It also must not receive pipelined queries: with more parallel queries than connections
 * (e.g. the admin page's Promise.all), postgres.js queues several on one connection and the pooler leaves
 * them half-sent — Postgres waits in ClientRead forever and the page hangs until the 300 s timeout.
 * max_pipeline: 1 keeps one query per connection; the rest wait for a free one.
 */
function connect(): Sql {
  const url = new URL(env.DATABASE_URL);
  const pooled = url.port === "6543";
  return postgres(env.DATABASE_URL, {
    max: pooled ? 5 : 10,
    prepare: !pooled,
    max_pipeline: pooled ? 1 : undefined,
    ssl: url.hostname === "localhost" || url.hostname === "127.0.0.1" ? false : "require",
    idle_timeout: pooled ? 20 : undefined,
    // Fail fast instead of hanging a page when the database can't be reached.
    connect_timeout: 10,
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
