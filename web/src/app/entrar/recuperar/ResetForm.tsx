"use client";

import { useActionState } from "react";
import type { LoginState } from "../actions";
import { Field, FormMessage, INPUT_CLASS } from "../ui";
import { requestPasswordReset } from "./actions";

const INITIAL: LoginState = { sent: false, message: "" };

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="E-mail">
        <input name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com" className={INPUT_CLASS} />
      </Field>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Enviando…" : "Enviar link"}</button>
      <FormMessage ok={state.sent} message={state.message} />
    </form>
  );
}
