import "server-only";
import type { InviteOutcome } from "../access-invite";
import { supabaseAuthEnabled } from "../auth";
import { siteOrigin } from "../site-origin";
import { ensureAuthUser, supabaseAdmin } from "../supabase/admin";
import { supabaseServer } from "../supabase/server";

/**
 * Invites someone who was just given access: makes sure they have a login account (confirmed e-mail,
 * no password yet) and sends the "Crie sua senha da DBI" e-mail. Its one-time link opens the
 * new-password screen, and right after saving the password the person is in.
 *
 * Same e-mail and template as "Primeiro acesso" (Supabase → Reset Password), so no extra setup.
 */
export async function sendAccessInvite(email: string): Promise<InviteOutcome> {
  const domain = email.split("@")[1];
  if (!supabaseAuthEnabled() || !supabaseAdmin()) return "unavailable";

  await ensureAuthUser(email);
  const origin = await siteOrigin();
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Used only if the e-mail template still points to {{ .ConfirmationURL }} (PKCE flow).
    redirectTo: `${origin}/auth/callback?next=/entrar/nova-senha`,
  });
  if (!error) {
    console.info(`[auth] access invitation sent (@${domain})`);
    return "sent";
  }
  console.error(`[auth] access invitation failed (@${domain}): status=${error.status} code=${error.code ?? "-"} ${error.message}`);
  return error.status === 429 ? "rate_limited" : "failed";
}
