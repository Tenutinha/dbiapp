"use server";

import { isInvited, supabaseAuthEnabled } from "@/lib/auth";
import { emailSchema } from "@/lib/login";
import { siteOrigin } from "@/lib/site-origin";
import { ensureAuthUser } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type { LoginState } from "../actions";

const GENERIC =
  "Se este e-mail tiver acesso, enviamos um link para criar uma nova senha. Confira sua caixa de entrada (e o spam).";

/**
 * "Esqueci minha senha" / "Primeiro acesso": e-mails a one-time link that opens the
 * new-password screen. Same answer for any address, so it reveals nothing about accounts.
 */
export async function requestPasswordReset(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { sent: false, message: "Login por e-mail não está ativo neste ambiente." };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { sent: false, message: parsed.error.issues[0]?.message ?? "E-mail inválido." };

  const domain = parsed.data.split("@")[1];
  if (!(await isInvited(parsed.data))) {
    console.warn(`[auth] password reset for a non-invited e-mail (@${domain}) — nothing sent`);
    return { sent: true, message: GENERIC };
  }

  // Invited people who never signed in have no Auth account yet; create it so the e-mail goes out.
  await ensureAuthUser(parsed.data);

  const origin = await siteOrigin();
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    // Used only if the e-mail template still points to {{ .ConfirmationURL }} (PKCE flow).
    redirectTo: `${origin}/auth/callback?next=/entrar/nova-senha`,
  });
  if (error) {
    console.error(`[auth] password reset failed (@${domain}): status=${error.status} code=${error.code ?? "-"} ${error.message}`);
    if (error.status === 429) return { sent: false, message: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
    return { sent: false, message: "Não conseguimos enviar o e-mail agora. Tente de novo em instantes." };
  }
  console.info(`[auth] password reset e-mail requested (@${domain})`);
  return { sent: true, message: GENERIC };
}
