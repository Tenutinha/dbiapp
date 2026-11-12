"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { recordPasswordAttempt, resolveSpaceLink } from "@/lib/data/space-links";
import { issuePass, LOCK_MS, MAX_FAILURES, MAX_PASSWORD, passCookieName, PASS_TTL_MS, verifyPassword } from "@/lib/link-password";
import { spaceLinkPath } from "@/lib/space-link";

export interface UnlockState {
  error: string | null;
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const lockedMessage = (until: Date): string =>
  `Muitas tentativas. Tente de novo depois das ${until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}.`;

/**
 * Password of a space's public link: a right one leaves a pass (cookie of this link only) and opens the
 * page; wrong ones are counted, and too many in a row lock the link for a while.
 */
export async function unlockSpaceLinkAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "").slice(0, MAX_PASSWORD);
  if (!TOKEN.test(token)) return { error: "Link inválido." };
  const link = await resolveSpaceLink(token);
  if (!link?.passwordHash) return { error: "Este link não está mais disponível." };
  if (link.lockedUntil && link.lockedUntil.getTime() > Date.now()) return { error: lockedMessage(link.lockedUntil) };

  const ok = password !== "" && verifyPassword(password, link.passwordHash);
  const lockedUntil = await recordPasswordAttempt(link.linkId, ok, MAX_FAILURES, LOCK_MS);
  if (!ok) {
    console.warn(`[space-link] wrong password for link ${link.linkId}`);
    return { error: lockedUntil ? lockedMessage(lockedUntil) : "Senha incorreta." };
  }

  (await cookies()).set(passCookieName(link.linkId), issuePass(link.linkId, link.passwordHash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: spaceLinkPath(token),
    maxAge: Math.floor(PASS_TTL_MS / 1000),
  });
  redirect(spaceLinkPath(token));
}
