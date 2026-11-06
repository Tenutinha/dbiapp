"use client";

import { useActionState, useEffect, useState } from "react";
import { requestLoginLink, type LoginState } from "./actions";

const INITIAL: LoginState = { sent: false, message: "" };

/** Supabase reports link problems in the URL hash (#error_code=…), which the server never sees. */
const HASH_ERRORS: Record<string, string> = {
  otp_expired: "Este link já foi usado ou expirou. Peça um novo link abaixo — e use sempre o e-mail mais recente.",
  access_denied: "Não foi possível entrar com este link. Peça um novo abaixo.",
};

function readHashError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = params.get("error_code") ?? params.get("error");
  if (!code) return null;
  return HASH_ERRORS[code] ?? HASH_ERRORS.access_denied;
}

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLoginLink, INITIAL);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const message = readHashError();
    if (!message) return;
    setLinkError(message);
    // Drop the error from the address bar so a reload does not show it again.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  return (
    <form action={action} className="flex flex-col gap-3">
      {linkError && !state.message && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{linkError}</p>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted">
        E-mail
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="voce@empresa.com"
          className="rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-text outline-none focus:border-brand"
        />
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Enviando…" : "Receber link de acesso"}</button>
      {state.message && (
        <p role="status" className={`text-sm ${state.sent ? "text-ok" : "text-danger"}`}>{state.message}</p>
      )}
    </form>
  );
}
