"use client";

import { useActionState, useState } from "react";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/login";
import type { LoginState } from "../actions";
import { Field, FormMessage, INPUT_CLASS } from "../ui";
import { updatePassword } from "./actions";

const INITIAL: LoginState = { sent: false, message: "" };

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, INITIAL);
  const [show, setShow] = useState(false);
  const type = show ? "text" : "password";
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nova senha">
        <input
          name="password"
          type={type}
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          autoComplete="new-password"
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Repita a nova senha">
        <input name="confirm" type={type} required autoComplete="new-password" className={INPUT_CLASS} />
      </Field>
      <p className="text-xs text-muted">Pelo menos {MIN_PASSWORD} caracteres, com letras e números.</p>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Mostrar senha
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar senha e entrar"}</button>
      <FormMessage ok={false} message={state.message} />
    </form>
  );
}
