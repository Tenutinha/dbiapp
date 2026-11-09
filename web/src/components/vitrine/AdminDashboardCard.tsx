"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadTemplateForEditAction, type TemplateForEdit } from "@/app/plataforma/catalogo/actions";
import { DashboardForm } from "@/components/admin/dashboard-form/DashboardForm";
import { CenteredModal } from "@/components/CenteredModal";
import type { CatalogRow } from "@/lib/data/catalog";
import { ORIGIN_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/templates/labels";

interface AdminDashboardCardProps {
  row: CatalogRow;
}

type LoadState = { phase: "idle" | "loading" } | { phase: "done"; result: TemplateForEdit; key: number };

/** Platform admin card: opens the edit form in a centered modal; status and deletion stay on the manage page. */
export function AdminDashboardCard({ row }: AdminDashboardCardProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ phase: "idle" });

  const fetchTemplate = async (): Promise<void> => {
    setLoad({ phase: "loading" });
    const result = await loadTemplateForEditAction(row.id);
    setLoad({ phase: "done", result, key: Date.now() });
  };

  return (
    <CenteredModal
      label={`Editar ${row.name}`}
      width={980}
      onOpen={() => void fetchTemplate()}
      trigger={(open) => (
        <div className="card group flex flex-col p-0 transition hover:border-brand/60">
          <button type="button" onClick={open} className="flex flex-1 flex-col gap-3 p-5 pb-2 text-left">
            <span className="flex w-full items-center justify-between gap-2 text-xs">
              <span className={`rounded-md px-2 py-0.5 font-semibold ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
              <span className="text-muted">{ORIGIN_LABEL[row.origin]} · {row.area}</span>
            </span>
            <span className="text-lg font-bold tracking-tight group-hover:text-brand-2">{row.name}</span>
            <span className="text-sm text-muted">{row.description}</span>
            <span className="mt-auto pt-2 text-xs text-muted">
              v{row.version} · em uso em {row.usage} {row.usage === 1 ? "dashboard" : "dashboards"}
              {row.builtIn && " · embutido"}
            </span>
          </button>
          <div className="flex items-center justify-between gap-2 px-5 pb-4 text-sm">
            <span className="flex items-center gap-3">
              <button type="button" onClick={open} className="font-semibold text-brand-2 hover:underline">Editar</button>
              <Link href={`/vitrine/${row.id}/demo`} className="font-semibold text-brand-2 hover:underline">Pré-visualizar</Link>
            </span>
            <Link href={`/plataforma/catalogo/${row.id}`} className="text-xs text-muted hover:text-text">Status e exclusão →</Link>
          </div>
        </div>
      )}
    >
      {(close) => <EditBody load={load} onSaved={() => { close(); router.refresh(); }} />}
    </CenteredModal>
  );
}

interface EditBodyProps {
  load: LoadState;
  onSaved: () => void;
}

function EditBody({ load, onSaved }: EditBodyProps) {
  if (load.phase !== "done") {
    return <div className="card p-8 text-center text-sm text-muted">Carregando o dashboard…</div>;
  }
  const { result } = load;
  if (!result.ok) return <div className="card p-8 text-center text-sm text-danger">{result.message}</div>;
  return (
    <DashboardForm
      key={load.key}
      stored={result.template}
      usage={result.usage}
      builtIn={result.builtIn}
      onSaved={onSaved}
    />
  );
}
