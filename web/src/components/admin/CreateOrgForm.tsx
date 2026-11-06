"use client";

import { useActionState, useEffect, useState } from "react";
import { createOrganizationAction, type PlatformFormState } from "@/app/plataforma/actions";
import { slugify } from "@/lib/permissions";

const INITIAL: PlatformFormState = { ok: false, message: "" };
const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand";

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  useEffect(() => {
    if (state.ok) {
      setName("");
      setSlug("");
    }
  }, [state]);

  return (
    <form action={action} className="card flex flex-col gap-3 p-5">
      <h2 className="font-semibold">Nova organização</h2>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Nome
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Odeon Tecnologia" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Endereço
        <div className="flex items-center rounded-lg border border-line bg-bg pl-3 text-sm focus-within:border-brand">
          <span className="text-muted">dbi.app.br/</span>
          <input
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder={slugify(name) || "odeontecnologia"}
            className="w-full bg-transparent py-2 pr-3 outline-none"
          />
        </div>
      </label>
      <p className="mt-1 text-xs text-muted">Primeiro admin da organização (opcional — você pode adicionar depois):</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="adminName" placeholder="Nome" className={INPUT} aria-label="Nome do admin" />
        <input name="adminEmail" type="email" placeholder="email@empresa.com" className={INPUT} aria-label="E-mail do admin" />
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Criando…" : "Criar organização"}</button>
      {state.message && <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}
