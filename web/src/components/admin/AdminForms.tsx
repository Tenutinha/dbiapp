"use client";

import { useActionState, useEffect, useState } from "react";
import { createClientAction, grantAccessAction, resendInviteAction, type FormState } from "@/app/[org]/admin/actions";

const INITIAL: FormState = { ok: false, message: "" };
const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand";

function Message({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

function slugPreview(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function CreateClientForm({ orgSlug }: { orgSlug: string }) {
  const [state, action, pending] = useActionState(createClientAction, INITIAL);
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
      <h3 className="font-semibold">Novo cliente</h3>
      <input type="hidden" name="org" value={orgSlug} />
      <label className="flex flex-col gap-1 text-xs text-muted">
        Nome
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Cliente 1" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Endereço
        <div className="flex items-center rounded-lg border border-line bg-bg pl-3 text-sm focus-within:border-brand">
          <span className="whitespace-nowrap text-muted">/{orgSlug}/</span>
          <input
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder={slugPreview(name) || "cliente1"}
            className="w-full bg-transparent py-2 pr-3 outline-none"
          />
        </div>
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Criando…" : "Criar cliente"}</button>
      <Message state={state} />
    </form>
  );
}

interface GrantAccessFormProps {
  orgSlug: string;
  clients: { id: string; name: string }[];
  /** Offer "Equipe da organização" as a destination (default true). */
  allowOrg?: boolean;
  title?: string;
  /** Renders without the card frame (inside a modal). */
  bare?: boolean;
  /** The organization has the "controle" module: client users are there to record entries, so "Analista" is suggested. */
  controle?: boolean;
}

export function GrantAccessForm({ orgSlug, clients, allowOrg = true, title = "Dar acesso", bare = false, controle = false }: GrantAccessFormProps) {
  const [state, action, pending] = useActionState(grantAccessAction, INITIAL);
  const initialScope = allowOrg ? "org" : (clients[0]?.id ?? "org");
  const [scope, setScope] = useState(initialScope);
  const isClient = scope !== "org";
  // React resets the form fields after a successful action; keep the controlled scope in sync.
  useEffect(() => {
    if (state.ok) setScope(initialScope);
  }, [state, initialScope]);

  return (
    <form action={action} className={`flex flex-col gap-3 ${bare ? "" : "card p-5"}`}>
      <h3 className="font-semibold">{title}</h3>
      <input type="hidden" name="org" value={orgSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Nome
          <input name="name" required className={INPUT} placeholder="Maria Souza" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          E-mail
          <input name="email" type="email" required className={INPUT} placeholder="maria@empresa.com" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Onde
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className={INPUT}>
            {allowOrg && <option value="org">Equipe da organização</option>}
            {clients.map((c) => <option key={c.id} value={c.id}>Cliente: {c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Papel
          <select name="role" key={isClient ? "client" : "org"} defaultValue={isClient ? (controle ? "analyst" : "viewer") : "editor"} className={INPUT}>
            {!isClient && <option value="admin">Admin — usuários, clientes e dados</option>}
            {!isClient && <option value="editor">Editor de dados — sobe e publica</option>}
            <option value="analyst">{isClient && controle ? "Analista — vê, compartilha e lança vendas e despesas" : "Analista — vê e compartilha"}</option>
            <option value="viewer">Leitor — só vê</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        {isClient
          ? controle
            ? "Usuários de cliente veem apenas esse cliente. No Controle, só o Analista lança, edita e exclui; o Leitor apenas vê."
            : "Usuários de cliente veem apenas os dashboards desse cliente."
          : "Admin e editor acessam todos os clientes; analista e leitor veem só os dashboards da organização."}
      </p>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="invite" defaultChecked className="mt-0.5" />
        <span>
          <span className="font-medium">Enviar convite por e-mail</span>
          <span className="block text-muted">A pessoa recebe um link para criar a senha e já entra.</span>
        </span>
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Dar acesso"}</button>
      <Message state={state} />
    </form>
  );
}

/** "Reenviar convite": the create-your-password e-mail again (lost, expired after 1 hour, or never sent). */
export function ResendInviteButton({ orgSlug, userId, name }: { orgSlug: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(resendInviteAction, INITIAL);
  const label = state.message ? (state.ok ? "Enviado" : "Falhou") : pending ? "Enviando…" : "Reenviar convite";
  return (
    <form action={action} className="inline shrink-0">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        title={state.message || `Enviar de novo a ${name} o e-mail para criar a senha e entrar`}
        className={`rounded px-1.5 py-0.5 text-[11px] transition hover:bg-text/5 ${state.message && !state.ok ? "text-danger" : state.ok ? "text-ok" : "text-muted hover:text-brand-2"}`}
      >
        {label}
      </button>
    </form>
  );
}
