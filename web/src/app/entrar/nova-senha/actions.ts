"use server";

import { redirect } from "next/navigation";
import { setOwnPassword } from "@/lib/password";
import type { LoginState } from "../actions";

/** Sets the password of the signed-in person (arrived via the reset link, or already logged in). */
export async function updatePassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await setOwnPassword(formData.get("password"), formData.get("confirm"));
  if (!result.ok) {
    // Keeps the old wording for an expired reset link on this page.
    const message = result.message.startsWith("Sua sessão expirou")
      ? "Seu link expirou. Peça um novo em \"Esqueci minha senha\"."
      : result.message;
    return { sent: false, message };
  }
  redirect("/");
}
