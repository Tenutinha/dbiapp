"use server";

import { redirect } from "next/navigation";
import { isInvited, supabaseAuthEnabled } from "@/lib/auth";
import { isOrgSlugTaken } from "@/lib/data/signup";
import { signupSchema } from "@/lib/login";
import { siteOrigin } from "@/lib/site-origin";
import { supabaseServer } from "@/lib/supabase/server";

export interface SignupState {
  ok: boolean;
  message: string;
  /** What was typed (minus passwords), so the form keeps it after an error. */
  values?: { name: string; company: string; slug: string; email: string };
}

const field = (formData: FormData, key: string, max = 320): string => String(formData.get(key) ?? "").slice(0, max);

/**
 * Self-service signup. Creates the Supabase account and sends the confirmation e-mail; the
 * organization is only created after the e-mail is confirmed (see provisionSelfSignup), so
 * unconfirmed sign-ups never reserve an address.
 */
export async function signUpAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const values = {
    name: field(formData, "name", 120),
    company: field(formData, "company", 120),
    slug: field(formData, "slug", 60),
    email: field(formData, "email"),
  };
  const fail = (message: string): SignupState => ({ ok: false, message, values });
  if (!supabaseAuthEnabled()) return fail("Cadastro não está ativo neste ambiente.");

  const parsed = signupSchema.safeParse({ ...values, password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Confira os dados.");
  const input = parsed.data;
  const domain = input.email.split("@")[1];

  if (await isInvited(input.email)) {
    return fail("Este e-mail já tem acesso. Entre com sua senha ou use \"Esqueci minha senha\".");
  }
  if (await isOrgSlugTaken(input.slug)) {
    return fail(`O endereço dbi.app.br/${input.slug} já está em uso. Escolha outro.`);
  }

  const origin = await siteOrigin();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { name: input.name, signup_org_name: input.company, signup_org_slug: input.slug },
    },
  });
  if (error) {
    console.error(`[auth] signup failed (@${domain}): status=${error.status} code=${error.code ?? "-"} ${error.message}`);
    if (error.status === 429) return fail("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    if (error.code === "weak_password") return fail("Senha fraca demais. Use letras, números e símbolos.");
    if (error.code === "signup_disabled") return fail("O cadastro está fechado no momento.");
    return fail("Não conseguimos criar sua conta agora. Tente de novo em instantes.");
  }

  // Projects with e-mail confirmation turned off return a session right away.
  if (data.session) {
    console.info(`[auth] signup without confirmation (@${domain})`);
    redirect("/");
  }
  console.info(`[auth] signup requested, confirmation e-mail sent (@${domain})`);
  return {
    ok: true,
    message: `Enviamos um e-mail para ${input.email}. Abra o link para confirmar e entrar na sua organização.`,
  };
}
