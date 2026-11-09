"use client";

import Link from "next/link";
import { RouteModal, type RouteModalTab } from "./RouteModal";

interface DataModalProps {
  /** Where closing goes back to (the admin page without ?dados). */
  closeHref: string;
  title: string;
  /** "Organização" or the client's name. */
  spaceName: string;
  /** Link to the published dashboard, when there is one. */
  dashboardHref: string | null;
  /** The full-page version of the same manager. */
  pageHref: string;
  /** The space's dashboards, to switch between them (shown when there is more than one). */
  tabs: RouteModalTab[];
  children: React.ReactNode;
}

/** The data manager of one dashboard in a centered modal over the admin table (?dados=<id>). */
export function DataModal({ closeHref, title, spaceName, dashboardHref, pageHref, tabs, children }: DataModalProps) {
  return (
    <RouteModal
      closeHref={closeHref}
      eyebrow={`Dados · ${spaceName}`}
      title={title}
      subtitle="Suba um arquivo por tabela. Validamos colunas, tipos e chaves contra o contrato e convertemos para Parquet."
      tabs={tabs}
      tabsLabel="Dashboards deste espaço"
      actions={
        <>
          {dashboardHref && <Link href={dashboardHref} className="btn btn-ghost px-3 py-1.5 text-xs">Ver dashboard</Link>}
          <Link href={pageHref} className="btn btn-ghost px-3 py-1.5 text-xs" title="Abrir em página inteira">⤢</Link>
        </>
      }
    >
      {children}
    </RouteModal>
  );
}
