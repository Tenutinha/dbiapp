"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadTemplateForEditAction, type TemplateForEdit } from "@/app/plataforma/catalogo/actions";
import { DashboardForm } from "@/components/admin/dashboard-form/DashboardForm";
import { CenteredModal } from "@/components/CenteredModal";
import type { CatalogRow } from "@/lib/data/catalog";
import { ORIGIN_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/templates/labels";
import { DeletePanel } from "./DashboardManagePanels";
import { StatusMenu } from "./StatusMenu";

interface AdminDashboardCardProps {
  row: CatalogRow;
  /** Open the edit modal right away (/?editar=<id>, e.g. back from the preview). */
  openOnLoad?: boolean;
}

type LoadState = { phase: "idle" | "loading" } | { phase: "done"; result: TemplateForEdit; key: number };

const TABS = [
  { id: "edit", label: "Edição" },
  { id: "delete", label: "Exclusão" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}


/**
 * Platform admin card: a click anywhere opens one modal with the tabs Edição and Exclusão. In the
 * corner, the flag icon changes the status in place and the eye goes straight to the preview.
 */
export function AdminDashboardCard({ row, openOnLoad = false }: AdminDashboardCardProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ phase: "idle" });
  const [tab, setTab] = useState<TabId>("edit");

  const fetchTemplate = async (): Promise<void> => {
    setTab("edit");
    setLoad({ phase: "loading" });
    const result = await loadTemplateForEditAction(row.id);
    setLoad({ phase: "done", result, key: Date.now() });
  };

  const done = (close: () => void): void => {
    close();
    router.refresh();
  };

  return (
    <CenteredModal
      label={`Gerenciar ${row.name}`}
      width={980}
      alignTop
      openOnLoad={openOnLoad}
      onOpen={() => void fetchTemplate()}
      trigger={(open) => (
        <div className="card group relative flex flex-col p-0 transition hover:border-brand/60">
          <button
            type="button"
            onClick={open}
            title="Editar ou excluir"
            className={`flex flex-1 flex-col gap-3 p-5 text-left in-data-[view=list]:flex-row in-data-[view=list]:items-center in-data-[view=list]:gap-4 in-data-[view=list]:py-3 in-data-[view=list]:pr-28`}
          >
            <span className={`flex w-full items-center justify-between gap-2 text-xs in-data-[view=list]:order-2 in-data-[view=list]:w-auto in-data-[view=list]:shrink-0 in-data-[view=list]:flex-col in-data-[view=list]:items-end in-data-[view=list]:gap-1`}>
              <span className={`rounded-md px-2 py-0.5 font-semibold ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
              <span className="text-muted">{ORIGIN_LABEL[row.origin]} · {row.area}</span>
            </span>
            <span className={`text-lg font-bold tracking-tight group-hover:text-brand-2 in-data-[view=list]:w-52 in-data-[view=list]:max-w-[35%] in-data-[view=list]:shrink-0 in-data-[view=list]:truncate in-data-[view=list]:text-base`}>{row.name}</span>
            <span className={`text-sm text-muted in-data-[view=list]:line-clamp-2 in-data-[view=list]:min-w-0 in-data-[view=list]:flex-1`}>{row.description}</span>
            <span className={`mt-auto pr-24 pt-2 text-xs text-muted in-data-[view=list]:hidden`}>
              v{row.version} · em uso em {row.usage} {row.usage === 1 ? "dashboard" : "dashboards"}
              {row.builtIn && " · embutido"}
            </span>
          </button>
          <div className={`absolute bottom-3.5 right-3.5 flex items-center gap-2 in-data-[view=list]:bottom-auto in-data-[view=list]:top-1/2 in-data-[view=list]:-translate-y-1/2`}>
            <StatusMenu id={row.id} name={row.name} status={row.status} />
            <Link
              href={`/vitrine/${row.id}/demo`}
              aria-label={`Pré-visualizar ${row.name}`}
              title="Pré-visualizar"
              className="grid size-9 place-items-center rounded-full border border-line text-muted transition hover:border-brand hover:bg-brand hover:text-white"
            >
              <EyeIcon />
            </Link>
          </div>
        </div>
      )}
    >
      {(close) => <ManageBody row={row} load={load} tab={tab} onTab={setTab} onDone={() => done(close)} />}
    </CenteredModal>
  );
}

interface ManageBodyProps {
  row: CatalogRow;
  load: LoadState;
  tab: TabId;
  onTab: (tab: TabId) => void;
  /** After a save or a deletion: close the modal and reload the vitrine. */
  onDone: () => void;
}

function ManageBody({ row, load, tab, onTab, onDone }: ManageBodyProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 pr-12">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{row.name}</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
        </span>
        <div role="tablist" aria-label="Gerenciar dashboard" className="flex gap-1 rounded-lg border border-line p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`rounded-md px-3 py-1 text-sm transition ${
                tab === t.id ? "bg-brand/10 font-semibold text-brand-2" : "text-muted hover:text-text"
              } ${t.id === "delete" && tab !== t.id ? "hover:text-danger" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Link href={`/vitrine/${row.id}/demo`} className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-brand-2 hover:underline">
          <EyeIcon /> Pré-visualizar
        </Link>
      </div>
      <TabContent row={row} load={load} tab={tab} onDone={onDone} />
    </div>
  );
}

function TabContent({ row, load, tab, onDone }: Omit<ManageBodyProps, "onTab">) {
  if (load.phase !== "done") return <div className="card p-8 text-center text-sm text-muted">Carregando o dashboard…</div>;
  const { result } = load;
  if (!result.ok) return <div className="card p-8 text-center text-sm text-danger">{result.message}</div>;

  if (tab === "delete") {
    return <DeletePanel id={row.id} name={row.name} usage={result.usage} builtIn={result.builtIn} onDeleted={onDone} />;
  }
  return (
    <DashboardForm
      key={load.key}
      stored={result.template}
      usage={result.usage}
      builtIn={result.builtIn}
      onSaved={onDone}
      maxHeightClass="max-h-[calc(100vh-6.5rem)]"
    />
  );
}
