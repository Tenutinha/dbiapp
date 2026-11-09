import "server-only";
import { supabaseAuthEnabled } from "./auth";
import { newPasswordSchema } from "./login";
import { supabaseServer } from "./supabase/server";

export type PasswordResult = { ok: true } | { ok: false; message: string };

/**
 * Sets the password of the signed-in person (Supabase Auth). Shared by the reset-link page
 * (/entrar/nova-senha) and "Meu perfil", so both apply the same rules and messages.
 */
export async function setOwnPassword(password: unknown, confirm: unknown): Promise<PasswordResult> {
  if (!supabaseAuthEnabled()) return { ok: false, message: "Login por e-mail não está ativo neste ambiente." };
  const parsed = newPasswordSchema.safeParse({ password, confirm });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Senha inválida." };

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "Sua sessão expirou. Entre de novo ou peça um link em \"Esqueci minha senha\"." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.warn(`[auth] password update failed: status=${error.status} code=${error.code ?? "-"}`);
    if (error.code === "same_password") return { ok: false, message: "A nova senha precisa ser diferente da atual." };
    if (error.code === "weak_password") return { ok: false, message: "Senha fraca demais. Use letras, números e símbolos." };
    if (error.code === "reauthentication_needed") {
      return { ok: false, message: "Por segurança, peça um novo link em \"Esqueci minha senha\" e tente de novo." };
    }
    return { ok: false, message: "Não foi possível salvar a senha agora. Tente de novo em instantes." };
  }
  console.info("[auth] password updated");
  return { ok: true };
}
