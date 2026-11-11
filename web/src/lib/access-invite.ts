/**
 * Access invitation e-mail: what the admin is told after asking for it. Pure (no I/O) so the wording
 * is unit tested; sending lives in services/access-invite.ts.
 */

/** How sending the "create your password" e-mail went. */
export type InviteOutcome = "sent" | "unavailable" | "rate_limited" | "failed";

/** Message after granting access, with or without the invitation e-mail. */
export function grantMessage(email: string, outcome: InviteOutcome | null): { ok: boolean; message: string } {
  if (outcome === null) return { ok: true, message: `Acesso concedido a ${email}.` };
  if (outcome === "sent") {
    return { ok: true, message: `Acesso concedido e convite enviado para ${email}: o link do e-mail leva a criar a senha e entrar.` };
  }
  return { ok: false, message: `Acesso concedido a ${email}, mas o convite não foi enviado: ${failureReason(outcome)}` };
}

/** Message after "Reenviar convite". */
export function resendMessage(email: string, outcome: InviteOutcome): { ok: boolean; message: string } {
  if (outcome === "sent") return { ok: true, message: `Convite reenviado para ${email}.` };
  return { ok: false, message: `Convite não enviado: ${failureReason(outcome)}` };
}

function failureReason(outcome: Exclude<InviteOutcome, "sent">): string {
  switch (outcome) {
    case "unavailable":
      return "o envio de e-mails não está ativo neste ambiente.";
    case "rate_limited":
      return "muitos e-mails em pouco tempo. Tente “Reenviar convite” em alguns minutos.";
    case "failed":
      return "tente “Reenviar convite” em instantes.";
  }
}
