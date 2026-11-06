import { AdminDashboardCard } from "@/components/vitrine/AdminDashboardCard";
import { NewDashboardModal } from "@/components/vitrine/NewDashboardModal";
import { VitrineCard } from "@/components/vitrine/VitrineCard";
import type { CatalogRow } from "@/lib/data/catalog";
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
            ? "Todo o catálogo, inclusive rascunhos e arquivados. Clique num dashboard para editar."
            : "Abra um para ver as tabelas que ele espera e adicione a uma organização."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {admin
          ? admin.rows.map((row) => <AdminDashboardCard key={row.id} row={row} />)
          : items.map((item) => <VitrineCard key={item.id} item={item} />)}
        {admin && <NewDashboardModal variant="card" />}
      </div>
    </section>
  );
}

