"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DashboardForm } from "@/components/admin/dashboard-form/DashboardForm";
import { CenteredModal } from "@/components/CenteredModal";

interface NewDashboardModalProps {
  /** "button" for page headers; "card" to sit at the end of a dashboards grid. */
  variant?: "button" | "card";
}

/** Platform admin: registers a new dashboard through the guided form, in a centered modal. */
export function NewDashboardModal({ variant = "button" }: NewDashboardModalProps) {
  const router = useRouter();
  // A new key gives the next registration a blank form.
  const [formKey, setFormKey] = useState(0);

  return (
    <CenteredModal
      label="Cadastrar dashboard"
      width={980}
      trigger={(open) =>
        variant === "card" ? (
          <button
            type="button"
            onClick={open}
            className="card group flex min-h-[200px] flex-col items-center justify-center gap-1 border-dashed p-5 text-center transition hover:border-brand/60"
          >
            <span className="text-2xl leading-none text-muted group-hover:text-brand-2" aria-hidden>+</span>
            <span className="text-lg font-bold group-hover:text-brand-2">Cadastrar dashboard</span>
            <span className="text-xs text-muted">Nome, análises, sumário e os arquivos que ele espera</span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={open}>
            + Cadastrar dashboard
          </button>
        )
      }
    >
      {(close) => (
        <DashboardForm
          key={formKey}
          stored={null}
          onSaved={() => {
            close();
            setFormKey((k) => k + 1);
            router.refresh();
          }}
        />
      )}
    </CenteredModal>
  );
}
