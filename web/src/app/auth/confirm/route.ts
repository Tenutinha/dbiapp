import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAuthEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/login";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Email link types this app sends (magic link, first-login confirmation, password reset). */
const ALLOWED_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery"];
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Email link landing (token_hash flow). The email points straight here with a one-time token,
 * which we verify on the server and turn into a session cookie. Unlike the PKCE flow
 * (/auth/callback), nothing has to be stored in the browser beforehand — so the link works in
 * another tab, browser or device.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (): NextResponse => NextResponse.redirect(new URL("/entrar?erro=1", url.origin));

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (!supabaseAuthEnabled() || !tokenHash || !TOKEN_HASH.test(tokenHash) || !type || !ALLOWED_TYPES.includes(type)) {
    return fail();
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error(`[auth] email link verification failed: status=${error.status} code=${error.code ?? "-"} ${error.message}`);
    return fail();
  }
  console.info(`[auth] email link verified (type=${type})`);
  // Password reset links always land on the new-password screen; others may carry ?next=/path.
  const next = type === "recovery" ? "/entrar/nova-senha" : safeNextPath(url.searchParams.get("next"));
  return NextResponse.redirect(new URL(next, url.origin));
}
