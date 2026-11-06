"use client";

import { TemplateJsonForm } from "@/components/admin/TemplateJsonForm";
import { CenteredModal } from "@/components/CenteredModal";

interface NewDashboardModalProps {
  /** "button" for page headers; "card" to sit at the end of a dashboards grid. */
  variant?: "button" | "card";
}

/**
 * Platform admin shortcut: opens the "register dashboard" form in a centered modal.
 * On success the action redirects to the catalog entry.
 */
export function NewDashboardModal({ variant = "button" }: NewDashboardModalProps) {
  return (
    <CenteredModal
      label="Cadastrar dashboard"
      trigger={(open) =>
        variant === "card" ? (
          <button
            type="button"
            onClick={open}
            className="card group flex min-h-[200px] flex-col items-center justify-center gap-1 border-dashed p-5 text-center transition hover:border-brand/60"
          >
            <span className="text-2xl leading-none text-muted group-hover:text-brand-2" aria-hidden>+</span>
            <span className="text-lg font-bold group-hover:text-brand-2">Cadastrar dashboard</span>
            <span className="text-xs text-muted">Envie o template.json de um novo dashboard para o catálogo</span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={open}>
            + Cadastrar dashboard
          </button>
        )
      }
    >
      {() => <TemplateJsonForm mode="create" />}
    </CenteredModal>
  );
}
