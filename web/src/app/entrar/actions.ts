"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isInvited, supabaseAuthEnabled } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export interface LoginState {
  sent: boolean;
  message: string;
}

const emailSchema = z.string().trim().toLowerCase().email("Digite um e-mail válido.");
const GENERIC = "Se este e-mail tiver acesso, enviamos um link para entrar. Confira sua caixa de entrada (e o spam).";

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Sends a magic link — only to people an admin already invited. The answer is the same either
 * way, so the form cannot be used to discover who has an account.
 */
export async function requestLoginLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { sent: false, message: "Login por e-mail não está ativo neste ambiente." };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { sent: false, message: parsed.error.issues[0]?.message ?? "E-mail inválido." };

  // Logs never contain the full address: only its domain, enough to diagnose delivery.
  const domain = parsed.data.split("@")[1];
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
