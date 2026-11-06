"use client";

import { useActionState } from "react";
import { requestLoginLink, type LoginState } from "./actions";

const INITIAL: LoginState = { sent: false, message: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLoginLink, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
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
