import { NextResponse } from "next/server";
import { supabaseAuthEnabled } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Magic-link landing: exchanges the one-time code for a session cookie, then goes home. */
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
  return NextResponse.redirect(new URL("/", url.origin));
}
