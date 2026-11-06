"use server";

import { redirect } from "next/navigation";
import { supabaseAuthEnabled } from "@/lib/auth";
import { newPasswordSchema } from "@/lib/login";
import { supabaseServer } from "@/lib/supabase/server";
import type { LoginState } from "../actions";

/** Sets the password of the signed-in person (arrived via the reset link, or already logged in). */
export async function updatePassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { sent: false, message: "Login por e-mail não está ativo neste ambiente." };
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { sent: false, message: parsed.error.issues[0]?.message ?? "Senha inválida." };

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { sent: false, message: "Seu link expirou. Peça um novo em \"Esqueci minha senha\"." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.warn(`[auth] password update failed: status=${error.status} code=${error.code ?? "-"}`);
    if (error.code === "same_password") return { sent: false, message: "A nova senha precisa ser diferente da atual." };
    if (error.code === "weak_password") return { sent: false, message: "Senha fraca demais. Use letras, números e símbolos." };
    if (error.code === "reauthentication_needed") {
      return { sent: false, message: "Por segurança, peça um novo link em \"Esqueci minha senha\" e tente de novo." };
    }
    return { sent: false, message: "Não foi possível salvar a senha agora. Tente de novo em instantes." };
  }
  console.info("[auth] password updated");
  redirect("/");
}
