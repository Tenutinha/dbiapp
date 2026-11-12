"use client";

import { useActionState } from "react";
import { unlockSpaceLinkAction, type UnlockState } from "./actions";

interface PasswordGateProps {
  token: string;
  spaceName: string;
}

const IDLE: UnlockState = { error: null };

/** Asked before a password-protected public link opens. */
export function PasswordGate({ token, spaceName }: PasswordGateProps) {
  const [state, action, pending] = useActionState(unlockSpaceLinkAction, IDLE);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <form action={action} className="card flex w-full max-w-sm flex-col gap-4 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Acesso protegido</p>
          <h1 className="mt-1 text-xl font-bold">{spaceName}</h1>
          <p className="mt-1 text-sm text-muted">Este link pede uma senha. Peça a quem enviou o link.</p>
        </div>
        <input type="hidden" name="token" value={token} />
        <label className="flex flex-col gap-1 text-sm">
          Senha
          <input
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-brand"
          />
        </label>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? "Conferindo…" : "Entrar"}</button>
      </form>
    </main>
  );
}
