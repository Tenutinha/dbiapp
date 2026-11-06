import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { sql } from "./db";
import { env } from "./env";
import { supabaseServer } from "./supabase/server";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  /** Platform administrator ("admin master"). */
  isPlatformAdmin: boolean;
}

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403 | 404, message: string) {
    super(message);
  }
}

export const DEV_USER_COOKIE = "dbi_dev_user";

/**
 * The dev user switcher ("entrar como") only exists outside production, with DBI_AUTH=dev,
 * and when explicitly enabled. It can never be turned on in a production build.
 */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && env.DBI_AUTH === "dev" && env.DBI_DEV_AUTH;
}

export function supabaseAuthEnabled(): boolean {
  return env.DBI_AUTH === "supabase";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SIGNED_IN = (): AccessError => new AccessError(401, "Entre para continuar.");

async function userByEmail(email: string): Promise<CurrentUser | null> {
  const [user] = await sql<CurrentUser[]>`
    SELECT id, email, name, is_platform_admin AS "isPlatformAdmin" FROM users WHERE email = ${email.toLowerCase()}`;
  return user ?? null;
}

/** Supabase Auth session → our users table, matched by (verified) e-mail. Only invited people get in. */
async function supabaseUser(): Promise<CurrentUser> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) throw NOT_SIGNED_IN();
  const user = await userByEmail(data.user.email);
  if (!user) throw new AccessError(403, "Seu e-mail ainda não tem acesso à plataforma.");
  return user;
}

async function devUser(): Promise<CurrentUser> {
  const chosen = (await cookies()).get(DEV_USER_COOKIE)?.value;
  if (chosen && UUID.test(chosen)) {
    const [user] = await sql<CurrentUser[]>`
      SELECT id, email, name, is_platform_admin AS "isPlatformAdmin" FROM users WHERE id = ${chosen}`;
    if (user) return user;
  }
  const demo = env.DBI_DEMO_USER_EMAIL ? await userByEmail(env.DBI_DEMO_USER_EMAIL) : null;
  if (!demo) throw new AccessError(401, "Usuário demo não encontrado — rode `npm run db:seed`.");
  return demo;
}

/** Current user: Supabase session in production, the "entrar como" choice in development. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  if (supabaseAuthEnabled()) return supabaseUser();
  if (devAuthEnabled()) return devUser();
  throw NOT_SIGNED_IN();
});

/** Whether `email` belongs to someone invited (used before sending a login link). */
export async function isInvited(email: string): Promise<boolean> {
  return (await userByEmail(email)) !== null;
}

export async function listUsersForDevSwitcher(): Promise<CurrentUser[]> {
  if (!devAuthEnabled()) return [];
  return sql<CurrentUser[]>`
    SELECT id, email, name, is_platform_admin AS "isPlatformAdmin" FROM users ORDER BY is_platform_admin DESC, email LIMIT 200`;
}
