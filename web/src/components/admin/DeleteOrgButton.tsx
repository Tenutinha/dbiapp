"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteOrganizationAction, type PlatformFormState } from "@/app/plataforma/actions";

interface DeleteOrgButtonProps {
  org: { id: string; name: string; slug: string };
  /** What goes with it, shown in the confirmation (e.g. "2 clientes · 5 dashboards · 3 pessoas"). */
  summary?: string;
}

const IDLE: PlatformFormState = { ok: false, message: "" };

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * Platform administrators only: deletes an organization for good (data, dashboards, people's access
 * and files). The confirmation asks for the organization's name, typed exactly.
 */
export function DeleteOrgButton({ org, summary }: DeleteOrgButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteOrganizationAction, IDLE);
  const matches = typed.trim() === org.name.trim();

  useEffect(() => {
    if (state.ok) dialog.current?.close();
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          dialog.current?.showModal();
        }}
        title={`Excluir ${org.name}`}
        aria-label={`Excluir ${org.name}`}
        className="absolute right-11 top-3 z-10 rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>

      <dialog
        ref={dialog}
        aria-label={`Excluir ${org.name}`}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-xl border border-line bg-card p-0 text-text shadow-2xl backdrop:bg-black/50"
      >
        <form action={action} className="flex flex-col gap-3 p-5">
          <input type="hidden" name="orgId" value={org.id} />
          <h2 className="text-lg font-semibold">Excluir {org.name}?</h2>
          <p className="text-sm text-muted">
            Isso apaga de vez a organização <span className="font-mono">dbi.app.br/{org.slug}</span>
            {summary ? ` (${summary})` : ""}: clientes, dashboards, dados publicados, arquivos e os acessos das pessoas.
            Não dá para desfazer.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span>Digite <strong>{org.name}</strong> para confirmar</span>
            <input
              name="confirmName"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="rounded-md border border-line bg-bg px-3 py-2"
            />
          </label>
          {state.message && !state.ok && <p role="alert" className="text-sm text-danger">{state.message}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-ghost">Cancelar</button>
            <button type="submit" disabled={!matches || pending} className="btn bg-danger text-white hover:opacity-90 disabled:opacity-40">
              {pending ? "Excluindo…" : "Excluir organização"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
