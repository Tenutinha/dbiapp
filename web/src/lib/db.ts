import "server-only";
import postgres from "postgres";
import { env } from "./env";

type Sql = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { __dbiSql?: Sql };

/** Single pooled client, reused across dev hot reloads. */
export const sql: Sql = globalForDb.__dbiSql ?? postgres(env.DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__dbiSql = sql;
