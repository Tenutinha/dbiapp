"use server";

import { redirect } from "next/navigation";
import { isInvited, supabaseAuthEnabled } from "@/lib/auth";
import { emailSchema, passwordSchema, signInErrorMessage } from "@/lib/login";
import { siteOrigin } from "@/lib/site-origin";
import { supabaseServer } from "@/lib/supabase/server";

export interface LoginState {
  sent: boolean;
  message: string;
  /** Typed e-mail, sent back so the form can keep it after an error (React resets forms on submit). */
  email?: string;
}

const GENERIC = "Se este e-mail tiver acesso, enviamos um link para entrar. Confira sua caixa de entrada (e o spam).";
const DISABLED = "Login por e-mail não está ativo neste ambiente.";
const domainOf = (email: string): string => email.split("@")[1] ?? "?";

/**
 * E-mail + password. Supabase checks the password; whether the account may use the platform is
 * decided afterwards by getCurrentUser (invited people, or confirmed self-service signups).
 * Wrong e-mail and wrong password get the same answer.
 */
export async function signInWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { sent: false, message: DISABLED };
  const typed = String(formData.get("email") ?? "").slice(0, 320);
  const fail = (message: string): LoginState => ({ sent: false, message, email: typed });
  const email = emailSchema.safeParse(typed);
  if (!email.success) return fail(email.error.issues[0]?.message ?? "E-mail inválido.");
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return fail(password.error.issues[0]?.message ?? "Senha inválida.");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password: password.data });
  if (error) {
    console.warn(`[auth] password sign-in failed (@${domainOf(email.data)}): status=${error.status} code=${error.code ?? "-"}`);
    return fail(signInErrorMessage(error));
  }
  redirect("/");
}

/**
 * Sends a magic link — only to people an admin already invited. The answer is the same either
 * way, so the form cannot be used to discover who has an account.
 */
export async function requestLoginLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { sent: false, message: DISABLED };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { sent: false, message: parsed.error.issues[0]?.message ?? "E-mail inválido." };

  // Logs never contain the full address: only its domain, enough to diagnose delivery.
  const domain = domainOf(parsed.data);
  if (!(await isInvited(parsed.data))) {
    console.warn(`[auth] login requested for a non-invited e-mail (@${domain}) — no link sent`);
    return { sent: true, message: GENERIC };
  }

  const origin = await siteOrigin();
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: true },
  });
  if (error) {
    console.error(`[auth] magic link failed (@${domain}): status=${error.status} code=${error.code ?? "-"} ${error.message}`);
    if (error.status === 429) return { sent: false, message: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
    return { sent: false, message: "Não conseguimos enviar o link agora. Tente de novo em instantes." };
  }
  console.info(`[auth] magic link requested from Supabase (@${domain}), redirect ${origin}/auth/callback`);
  return { sent: true, message: GENERIC };
}

export async function signOutAction(): Promise<void> {
  if (supabaseAuthEnabled()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/entrar");
}
