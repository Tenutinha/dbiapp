import { z } from "zod";

/** Login and password form rules shared by the server actions. Pure: no I/O, safe to unit test. */

export const emailSchema = z.string().trim().toLowerCase().email("Digite um e-mail válido.");

export const passwordSchema = z.string().min(1, "Digite sua senha.").max(256, "Senha longa demais.");

export const MIN_PASSWORD = 8;
/** bcrypt (Supabase Auth) ignores bytes after 72. */
export const MAX_PASSWORD = 72;

const strongPassword = z
  .string()
  .min(MIN_PASSWORD, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
  .max(MAX_PASSWORD, `A senha pode ter no máximo ${MAX_PASSWORD} caracteres.`)
  .regex(/[A-Za-zÀ-ÿ]/, "Use pelo menos uma letra.")
  .regex(/\d/, "Use pelo menos um número.");

const passwordsMatch = (v: { password: string; confirm: string }): boolean => v.password === v.confirm;
const MISMATCH = { path: ["confirm"], message: "As senhas não conferem." };

export const newPasswordSchema = z
  .object({ password: strongPassword, confirm: z.string() })
  .refine(passwordsMatch, MISMATCH);

const SAFE_PATH = /^\/(?![/\\])[A-Za-z0-9/_-]*$/;

/** Where to go after an e-mail link. Only plain same-site paths — never another host. */
export function safeNextPath(next: string | null | undefined): string {
  return next && SAFE_PATH.test(next) ? next : "/";
}

export interface AuthErrorLike {
  status?: number;
  code?: string;
}

/** Supabase sign-in error → message for the person. Never says whether the e-mail exists. */
export function signInErrorMessage(error: AuthErrorLike): string {
  if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (error.code === "invalid_credentials") return "E-mail ou senha incorretos.";
  if (error.code === "email_not_confirmed") {
    return "Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou use \"Esqueci minha senha\".";
  }
  return "Não foi possível entrar agora. Tente de novo em instantes.";
}
