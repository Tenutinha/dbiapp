"use client";

import { useActionState, useState } from "react";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/login";
import { slugify } from "@/lib/permissions";
import { Field, FormMessage, INPUT_CLASS } from "../ui";
import { signUpAction, type SignupState } from "./actions";

const INITIAL: SignupState = { ok: false, message: "" };

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL);
  const [company, setCompany] = useState("");
  const [show, setShow] = useState(false);
  const type = show ? "text" : "password";
  const values = state.values;

  if (state.ok) {
    return (
      <div role="status" className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-4 text-sm text-ok">
        {state.message}
        <p className="mt-2 text-xs text-muted">Não chegou? Confira o spam ou tente de novo em alguns minutos.</p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Seu nome">
        <input name="name" required autoComplete="name" defaultValue={values?.name} placeholder="Ana Souza" className={INPUT_CLASS} />
      </Field>
      <Field label="Empresa">
        <input
          name="company"
          required
          autoComplete="organization"
          defaultValue={values?.company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Odeon Tecnologia"
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Endereço da sua organização">
        <span className="flex items-center rounded-lg border border-line bg-bg pl-3 text-sm focus-within:border-brand">
          <span className="text-muted">dbi.app.br/</span>
          <input
            name="slug"
            defaultValue={values?.slug}
            placeholder={slugify(company || values?.company || "") || "sua-empresa"}
            pattern="[a-zA-Z0-9-]*"
            maxLength={40}
            className="w-full bg-transparent py-2.5 pr-3 text-text outline-none"
          />
        </span>
      </Field>
      <Field label="E-mail de trabalho">
        <input name="email" type="email" required autoComplete="email" defaultValue={values?.email} placeholder="voce@empresa.com" className={INPUT_CLASS} />
      </Field>
      <Field label="Senha">
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
      <Field label="Repita a senha">
        <input name="confirm" type={type} required autoComplete="new-password" className={INPUT_CLASS} />
      </Field>
      <p className="text-xs text-muted">Pelo menos {MIN_PASSWORD} caracteres, com letras e números.</p>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Mostrar senha
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Criando conta…" : "Criar conta"}</button>
      <FormMessage ok={false} message={state.message} />
    </form>
  );
}
