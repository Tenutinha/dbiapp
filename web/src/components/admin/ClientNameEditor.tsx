"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { renameClientAction, type FormState } from "@/app/[org]/admin/actions";
import { slugify } from "@/lib/permissions";

const INITIAL: FormState = { ok: false, message: "" };

interface ClientNameEditorProps {
  orgSlug: string;
  clientId: string;
  name: string;
  /** Current address part: /<org>/<slug>. */
  slug: string;
  /** Rendered after the name when not editing (e.g. the theme gear). */
  children?: React.ReactNode;
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** The editing form: name + address; the address follows the name until edited by hand. */
function EditForm({ orgSlug, clientId, name, slug, onCancel, state, action, pending }: {
  orgSlug: string; clientId: string; name: string; slug: string; onCancel: () => void;
  state: FormState; action: (formData: FormData) => void; pending: boolean;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftSlug, setDraftSlug] = useState(slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const changesAddress = draftSlug !== slug;

  return (
    <form
      action={action}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="flex flex-col gap-1.5"
    >
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="clientId" value={clientId} />
      <label className="sr-only" htmlFor={`rename-${clientId}`}>Nome do cliente</label>
      <input
        id={`rename-${clientId}`}
        name="name"
        value={draftName}
        onChange={(e) => {
          setDraftName(e.target.value);
          if (!slugTouched) setDraftSlug(slugify(e.target.value));
        }}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        required
        minLength={2}
        maxLength={80}
        className="w-full rounded-md border border-brand bg-bg px-2 py-1 text-sm font-semibold outline-none"
      />
      <label className="flex items-center rounded-md border border-line bg-bg pl-2 font-mono text-[11px] focus-within:border-brand">
        <span className="whitespace-nowrap text-muted">/{orgSlug}/</span>
        <span className="sr-only">Endereço</span>
        <input
          name="slug"
          value={draftSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setDraftSlug(e.target.value.toLowerCase());
          }}
          maxLength={40}
          className="w-full min-w-0 bg-transparent py-1 pr-2 outline-none"
        />
      </label>
      {changesAddress && (
        <p className="text-[11px] text-accent">
          O endereço muda de /{slug} para /{draftSlug || "…"}. Links salvos com o endereço antigo deixam de abrir;
          links compartilhados continuam funcionando.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary px-2.5 py-1 text-xs">{pending ? "Salvando…" : "Salvar"}</button>
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-text">Cancelar</button>
      </div>
      {!state.ok && state.message && <p role="alert" className="text-[11px] text-danger">{state.message}</p>}
    </form>
  );
}

/**
 * A client's name and address in the admin table, editable in place: the pencil opens the form
 * (Enter saves, Esc cancels). The address (/<org>/<client>) follows the name unless edited by hand.
 */
export function ClientNameEditor({ orgSlug, clientId, name, slug, children }: ClientNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(renameClientAction, INITIAL);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <EditForm
        orgSlug={orgSlug} clientId={clientId} name={name} slug={slug}
        onCancel={() => setEditing(false)} state={state} action={action} pending={pending}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Link href={`/${orgSlug}/${slug}`} className="min-w-0 truncate font-semibold hover:text-brand-2">{name}</Link>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={`Renomear ${name} (nome e endereço)`}
          aria-label={`Renomear ${name}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-text/5 hover:text-text"
        >
          <PencilIcon />
        </button>
        {children}
      </div>
      {state.ok && state.message && <p role="status" className="text-[11px] text-ok">✓ {state.message}</p>}
    </div>
  );
}
