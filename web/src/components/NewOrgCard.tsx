"use client";

import { CreateOrgForm } from "@/components/admin/CreateOrgForm";
import { CenteredModal } from "@/components/CenteredModal";

/** Last card of the organizations grid (platform admin only): opens the "new organization" form centered on screen. */
export function NewOrgCard() {
  return (
    <CenteredModal
      label="Nova organização"
      width={520}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          className="card group flex min-h-[116px] flex-col items-center justify-center gap-1 border-dashed p-5 text-center transition hover:border-brand/60"
        >
          <span className="text-2xl leading-none text-muted group-hover:text-brand-2" aria-hidden>+</span>
          <span className="text-lg font-bold group-hover:text-brand-2">Nova organização</span>
          <span className="text-xs text-muted">Crie o espaço de uma empresa e indique o primeiro admin</span>
        </button>
      )}
    >
      {(close) => <CreateOrgForm onCreated={close} />}
    </CenteredModal>
  );
}
