"use client";

import { useActionState, useState } from "react";
import { createSpaceLinkAction, revokeSpaceLinkAction, type FormState } from "@/app/[org]/admin/actions";
import { formatDateTime } from "@/lib/format";
import { EXPIRY_CHOICES, spaceLinkPath } from "@/lib/space-link";

export interface SpaceLinkView {
  token: string;
  /** ISO date, or null when it never expires. */
  expiresAt: string | null;
}

interface SpaceLinkControlProps {
  orgSlug: string;
  /** "" for the organization's own space, else the client's id. */
  clientId: string;
  spaceName: string;
  link: SpaceLinkView | null;
  /** Published dashboards of the space (what the link shows). */
  published: number;
}

const IDLE: FormState = { ok: false, message: "" };
const SUBTLE = "text-xs text-muted hover:text-brand-2";
const MINI = "rounded px-1.5 py-0.5 text-[11px] transition hover:bg-text/5";

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function CopyLink({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button type="button" onClick={copy} className={`${MINI} text-brand-2`}>
      {state === "ok" ? "Copiado" : state === "fail" ? "Copie manualmente" : "Copiar"}
    </button>
  );
}

/**
 * "Link público" in the admin's Acessos column — one discreet line, like "Gerenciar usuários": anyone
 * with the link sees the space's published dashboards, read-only, without an account. One link per
 * space; it can expire and be revoked.
 */
export function SpaceLinkControl({ orgSlug, clientId, spaceName, link, published }: SpaceLinkControlProps) {
  const [created, create, creating] = useActionState(createSpaceLinkAction, IDLE);
  const [revoked, revoke, revoking] = useActionState(revokeSpaceLinkAction, IDLE);
  const [mode, setMode] = useState<"idle" | "creating" | "revoking">("idle");
  const feedback = [created, revoked].find((s) => s.message && !s.ok);
  const hidden = (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="clientId" value={clientId} />
    </>
  );

  let body: React.ReactNode;
  if (link) {
    const path = spaceLinkPath(link.token);
    const until = link.expiresAt ? `válido até ${formatDateTime(new Date(link.expiresAt))}` : "sem expiração";
    body = mode === "revoking" ? (
      <form action={revoke} className="flex items-center gap-1">
        {hidden}
        <span className="text-[11px] text-danger">Desligar o link?</span>
        <button type="submit" disabled={revoking} className={`${MINI} text-danger`}>{revoking ? "…" : "Sim"}</button>
        <button type="button" onClick={() => setMode("idle")} className={`${MINI} text-muted`}>Não</button>
      </form>
    ) : (
      <span className="flex items-center gap-1">
        <span
          className="flex items-center gap-1 text-xs text-ok"
          title={`dbi.app.br${path}\nQuem tiver o link vê ${published} dashboard${published === 1 ? "" : "s"} de ${spaceName}, sem login · ${until}`}
        >
          <LinkIcon /> Link público{link.expiresAt ? ` · até ${shortDate(link.expiresAt)}` : ""}
        </span>
        <CopyLink path={path} />
        <button type="button" onClick={() => setMode("revoking")} className={`${MINI} text-muted hover:text-danger`} title="Desligar o link">
          Desligar
        </button>
      </span>
    );
  } else if (mode === "creating") {
    body = (
      <form action={create} className="flex items-center gap-1">
        {hidden}
        <select
          name="expiry"
          defaultValue="30"
          aria-label="Validade do link"
          className="rounded border border-line bg-bg px-1 py-0.5 text-[11px]"
        >
          {EXPIRY_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button type="submit" disabled={creating} className={`${MINI} font-medium text-brand-2`}>{creating ? "…" : "Liberar"}</button>
        <button type="button" onClick={() => setMode("idle")} className={`${MINI} text-muted`} aria-label="Cancelar">×</button>
      </form>
    );
  } else {
    body = (
      <button
        type="button"
        onClick={() => setMode("creating")}
        className={`flex items-center gap-1 ${SUBTLE}`}
        title={`Libera ${spaceName} para quem tiver o link: dashboards publicados, somente leitura, sem login${published === 0 ? " (ainda não há nenhum publicado)" : ""}`}
      >
        <LinkIcon /> Liberar link público
      </button>
    );
  }

  return (
    <div className="mt-1.5">
      {body}
      {feedback && <p role="alert" className="mt-1 text-[11px] text-danger">{feedback.message}</p>}
    </div>
  );
}
