import { z } from "zod";
import { isValidSlug, slugify } from "./permissions";

/** Login and signup form rules shared by the server actions. Pure: no I/O, safe to unit test. */

export const emailSchema = z.string().trim().toLowerCase().email("Digite um e-mail válido.");

export const passwordSchema = z.string().min(1, "Digite sua senha.").max(256, "Senha longa demais.");

export const MIN_PASSWORD = 8;
/** bcrypt (Supabase Auth) ignores bytes after 72. */
export const MAX_PASSWORD = 72;
/** Organization addresses are limited to 40 characters (see permissions.ts). */
const MAX_SLUG = 40;

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

const personName = z.string().trim().min(2, "Informe seu nome.").max(80, "Nome longo demais.");
const companyName = z.string().trim().min(2, "Informe o nome da empresa.").max(80, "Nome da empresa longo demais.");

/** Self-service signup: person + their organization. A blank address is derived from the company name. */
export const signupSchema = z
  .object({
    name: personName,
    company: companyName,
    slug: z.string().trim().toLowerCase().max(MAX_SLUG, "Endereço longo demais.").optional(),
    email: emailSchema,
    password: strongPassword,
    confirm: z.string(),
  })
  .refine(passwordsMatch, MISMATCH)
  .transform((v) => ({ ...v, slug: v.slug ? v.slug : slugify(v.company) }))
  .refine((v) => isValidSlug(v.slug), {
    path: ["slug"],
    message: "Endereço inválido ou reservado. Use letras minúsculas, números e hífen.",
  });

export type SignupInput = z.output<typeof signupSchema>;

/** "odeon" → ["odeon", "odeon-2", …], each within the address length limit. */
export function slugCandidates(slug: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return slug;
    const suffix = `-${i + 1}`;
    return `${slug.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "")}${suffix}`;
  });
}

export interface SignupMetadata {
  name: string;
  orgName: string;
  slug: string;
}

/**
 * What the signup form stored on the Supabase account (user_metadata). Null for accounts that
 * did not come from the form (e.g. invited people), or when the data is not usable.
 */
export function readSignupMetadata(meta: Record<string, unknown> | undefined): SignupMetadata | null {
  const parsed = z
    .object({ name: personName, signup_org_name: companyName, signup_org_slug: z.string() })
    .safeParse(meta ?? {});
  if (!parsed.success || !isValidSlug(parsed.data.signup_org_slug)) return null;
  return { name: parsed.data.name, orgName: parsed.data.signup_org_name, slug: parsed.data.signup_org_slug };
}

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
