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
  /** Public avatar id (null = initials). Read via to_jsonb: null before migration 012. */
  avatarKey: string | null;
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
    SELECT id, email, name, is_platform_admin AS "isPlatformAdmin", to_jsonb(users) ->> 'avatar_key' AS "avatarKey" FROM users WHERE email = ${email.toLowerCase()}`;
  return user ?? null;
}

/**
 * Supabase Auth session → our users table, matched by (verified) e-mail. Only invited people are
 * there: nobody gets an account or an organization by signing up on their own.
 */
async function supabaseUser(): Promise<CurrentUser> {
  const supabase = await supabaseServer();
  // Fast path: verifies the session JWT locally against the project's signing keys (no round
  // trip to Supabase Auth). Middleware already refreshed the session for this request.
  const claims = await supabase.auth.getClaims();
  const claimedEmail = claims.data?.claims.email;
  if (claims.error || typeof claimedEmail !== "string" || !claimedEmail) throw NOT_SIGNED_IN();
  const known = await userByEmail(claimedEmail);
  if (known) return known;

  // A Supabase account without a DBI user: nobody invited this e-mail. Self-service signup is closed
  // (organizations are created only by platform administrators), so it gets no access.
  throw new AccessError(403, "Seu e-mail ainda não tem acesso à plataforma.");
}

async function devUser(): Promise<CurrentUser> {
  const chosen = (await cookies()).get(DEV_USER_COOKIE)?.value;
  if (chosen && UUID.test(chosen)) {
    const [user] = await sql<CurrentUser[]>`
      SELECT id, email, name, is_platform_admin AS "isPlatformAdmin", to_jsonb(users) ->> 'avatar_key' AS "avatarKey" FROM users WHERE id = ${chosen}`;
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
    SELECT id, email, name, is_platform_admin AS "isPlatformAdmin", to_jsonb(users) ->> 'avatar_key' AS "avatarKey" FROM users ORDER BY is_platform_admin DESC, email LIMIT 200`;
}
