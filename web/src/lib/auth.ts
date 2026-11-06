import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { sql } from "./db";
import { env } from "./env";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403 | 404, message: string) {
    super(message);
  }
}

export const DEV_USER_COOKIE = "dbi_dev_user";

/**
 * The dev user switcher ("entrar como") only exists outside production and when explicitly enabled.
 * It fails closed: in production there is no user until Supabase Auth is wired in here.
 */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && env.DBI_DEV_AUTH;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Current user. Single place to swap for Supabase Auth (read the session, map to users.id).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  if (!devAuthEnabled()) throw new AccessError(401, "Login ainda não configurado neste ambiente.");
  const chosen = (await cookies()).get(DEV_USER_COOKIE)?.value;
  if (chosen && UUID.test(chosen)) {
    const [user] = await sql<CurrentUser[]>`SELECT id, email, name FROM users WHERE id = ${chosen}`;
    if (user) return user;
  }
  const [demo] = await sql<CurrentUser[]>`
    SELECT id, email, name FROM users WHERE email = ${env.DBI_DEMO_USER_EMAIL}`;
  if (!demo) throw new AccessError(401, "Usuário demo não encontrado — rode `npm run db:seed`.");
  return demo;
});

export async function listUsersForDevSwitcher(): Promise<CurrentUser[]> {
  if (!devAuthEnabled()) return [];
  return sql<CurrentUser[]>`SELECT id, email, name FROM users ORDER BY email LIMIT 200`;
}
