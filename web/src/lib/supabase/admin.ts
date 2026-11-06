import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let client: SupabaseClient | null = null;

/**
 * Service-role client (server only). Returns null when the secret is not configured, so callers
 * can degrade gracefully instead of failing the whole request.
 */
export function supabaseAdmin(): SupabaseClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/**
 * Makes sure an invited person has a Supabase Auth account (confirmed e-mail, no password yet),
 * so a "create/reset password" e-mail can reach them even if they never signed in before.
 */
export async function ensureAuthUser(email: string): Promise<void> {
  const admin = supabaseAdmin();
  if (!admin) return;
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error && error.code !== "email_exists" && error.status !== 422) {
    console.error(`[auth] could not prepare account (@${email.split("@")[1]}): status=${error.status} code=${error.code ?? "-"}`);
  }
}
