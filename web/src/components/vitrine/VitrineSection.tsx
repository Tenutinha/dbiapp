import Link from "next/link";
import { NewDashboardModal } from "@/components/vitrine/NewDashboardModal";
import { VitrineCard } from "@/components/vitrine/VitrineCard";
import type { CatalogRow } from "@/lib/data/catalog";
import { ORIGIN_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/templates/labels";
import type { VitrineItem } from "@/lib/vitrine";

/** Anchor of the showcase section, on the landing page and on the signed-in home. */
export const VITRINE_ANCHOR = "vitrine";

interface VitrineSectionProps {
  /** Published showcase dashboards (what visitors and organization users see). */
  items: VitrineItem[];
  /** Platform admin view: the whole catalog (drafts and archived too), plus the "register" card. */
  admin?: { rows: CatalogRow[] } | null;
  className?: string;
}

/** "Dashboards prontos": the showcase grid shared by the landing page and the signed-in home. */
export function VitrineSection({ items, admin, className = "" }: VitrineSectionProps) {
  if (!admin && items.length === 0) return null;
  return (
    <section id={VITRINE_ANCHOR} className={`scroll-mt-20 ${className}`} aria-labelledby="vitrine-titulo">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Vitrine</p>
        <h2 id="vitrine-titulo" className="mt-1 text-xl font-extrabold tracking-tight">Dashboards prontos</h2>
        <p className="mt-1 text-sm text-muted">
          {admin
            ? "Todo o catálogo, inclusive rascunhos e arquivados. Abra um dashboard para editar, publicar ou arquivar."
            : "Abra um para ver as tabelas que ele espera e adicione a uma organização."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {admin
          ? admin.rows.map((row) => <CatalogAdminCard key={row.id} row={row} />)
          : items.map((item) => <VitrineCard key={item.id} item={item} />)}
        {admin && <NewDashboardModal variant="card" />}
      </div>
    </section>
  );
}

/** Platform admin card: status, usage and version; opens the management page. */
function CatalogAdminCard({ row }: { row: CatalogRow }) {
  return (
    <Link href={`/plataforma/catalogo/${row.id}`} className="card group flex flex-col gap-3 p-5 transition hover:border-brand/60">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`rounded-md px-2 py-0.5 font-semibold ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
        <span className="text-muted">{ORIGIN_LABEL[row.origin]} · {row.area}</span>
      </div>
      <h3 className="text-lg font-bold tracking-tight group-hover:text-brand-2">{row.name}</h3>
      <p className="text-sm text-muted">{row.description}</p>
      <p className="mt-auto pt-2 text-xs text-muted">
        v{row.version} · em uso em {row.usage} {row.usage === 1 ? "dashboard" : "dashboards"}
        {row.builtIn && " · embutido"}
      </p>
      <span className="text-sm font-semibold text-brand-2">Gerenciar →</span>
    </Link>
  );
}
