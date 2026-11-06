"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { requestLoginLink, signInWithPassword, type LoginState } from "./actions";
import { Alert, Field, FormMessage, INPUT_CLASS } from "./ui";

const INITIAL: LoginState = { sent: false, message: "" };

/** Supabase reports link problems in the URL hash (#error_code=…), which the server never sees. */
const HASH_ERRORS: Record<string, string> = {
  otp_expired: "Este link já foi usado ou expirou. Entre com sua senha ou peça um novo link.",
  access_denied: "Não foi possível entrar com este link. Entre com sua senha ou peça um novo link.",
};

function readHashError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = params.get("error_code") ?? params.get("error");
  if (!code) return null;
  return HASH_ERRORS[code] ?? HASH_ERRORS.access_denied;
}

type Mode = "password" | "link";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("password");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const message = readHashError();
    if (!message) return;
    setLinkError(message);
    // Drop the error from the address bar so a reload does not show it again.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {linkError && <Alert>{linkError}</Alert>}
      {mode === "password" ? <PasswordForm /> : <MagicLinkForm />}

      {/* Future: "Continuar com Google" / "Continuar com Microsoft" buttons go above this divider. */}
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setMode(mode === "password" ? "link" : "password")}
      >
        {mode === "password" ? "Receber link de acesso por e-mail" : "Entrar com e-mail e senha"}
      </button>
      <div className="flex flex-col gap-1 text-center text-sm text-muted">
        <p>
          Não tem conta?{" "}
          <Link href="/entrar/cadastro" className="text-text underline underline-offset-4 hover:text-brand">
            Criar conta
          </Link>
        </p>
        <p>
          Foi convidado?{" "}
          <Link href="/entrar/recuperar?primeiro=1" className="text-text underline underline-offset-4 hover:text-brand">
            Crie sua senha
          </Link>
        </p>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState(signInWithPassword, INITIAL);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="E-mail">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="voce@empresa.com"
          defaultValue={state.email}
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        label="Senha"
        hint={
          <Link href="/entrar/recuperar" className="text-xs text-muted underline underline-offset-4 hover:text-brand">
            Esqueci minha senha
          </Link>
        }
      >
        <span className="relative flex">
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            className={`${INPUT_CLASS} w-full pr-16`}
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute inset-y-0 right-2 my-auto h-fit px-1 text-xs text-muted hover:text-text"
            aria-label={show ? "Esconder senha" : "Mostrar senha"}
          >
            {show ? "Esconder" : "Mostrar"}
          </button>
        </span>
      </Field>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      <FormMessage ok={false} message={state.message} />
    </form>
  );
}

function MagicLinkForm() {
  const [state, action, pending] = useActionState(requestLoginLink, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="E-mail">
        <input name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com" className={INPUT_CLASS} />
      </Field>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Enviando…" : "Receber link de acesso"}</button>
      <FormMessage ok={state.sent} message={state.message} />
    </form>
  );
}
