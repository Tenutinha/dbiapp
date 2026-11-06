import { NextResponse } from "next/server";
import { supabaseAuthEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/login";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** PKCE e-mail link landing: exchanges the one-time code for a session cookie, then goes to ?next (or home). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!supabaseAuthEnabled() || !code) return NextResponse.redirect(new URL("/entrar?erro=1", url.origin));

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth] code exchange failed", error.message);
    return NextResponse.redirect(new URL("/entrar?erro=1", url.origin));
  }
  return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
}
