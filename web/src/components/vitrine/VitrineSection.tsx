import { AdminDashboardCard } from "@/components/vitrine/AdminDashboardCard";
import { NewDashboardModal } from "@/components/vitrine/NewDashboardModal";
import { VitrineBrowser, type VitrineEntry } from "@/components/vitrine/VitrineBrowser";
import { VitrineCard } from "@/components/vitrine/VitrineCard";
import type { CatalogRow } from "@/lib/data/catalog";
import { ORIGIN_LABEL, STATUS_LABEL } from "@/lib/templates/labels";
import type { VitrineItem } from "@/lib/vitrine";

/** Anchor of the showcase section, on the landing page and on the signed-in home. */
export const VITRINE_ANCHOR = "vitrine";

interface VitrineSectionProps {
  /** Published showcase dashboards (what visitors and organization users see). */
  items: VitrineItem[];
  /** Platform admin view: the whole catalog (drafts and archived too), plus the "register" button. */
  admin?: { rows: CatalogRow[]; editId?: string | null } | null;
  className?: string;
}

/** editId (from ?editar=): that dashboard opens straight in its edit modal (back from the preview). */
function adminEntries(rows: CatalogRow[], editId: string | null): VitrineEntry[] {
  return rows.map((row) => ({
    id: row.id,
    text: [row.name, row.description, row.area, ORIGIN_LABEL[row.origin], STATUS_LABEL[row.status], row.id].join(" "),
    node: <AdminDashboardCard key={row.id} row={row} openOnLoad={row.id === editId} />,
  }));
}

function publicEntries(items: VitrineItem[]): VitrineEntry[] {
  return items.map((item) => ({
    id: item.id,
    text: [item.name, item.description, item.area, ORIGIN_LABEL[item.origin], ...item.tables].join(" "),
    node: <VitrineCard key={item.id} item={item} />,
  }));
}

/** "Dashboards prontos": the showcase shared by the landing page and the signed-in home. */
export function VitrineSection({ items, admin, className = "" }: VitrineSectionProps) {
  if (!admin && items.length === 0) return null;
  return (
    <section id={VITRINE_ANCHOR} className={`scroll-mt-20 ${className}`} aria-labelledby="vitrine-titulo">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Vitrine</p>
        <h2 id="vitrine-titulo" className="mt-1 text-xl font-extrabold tracking-tight">Dashboards prontos</h2>
        <p className="mt-1 text-sm text-muted">
          {admin
            ? "Todo o catálogo, inclusive rascunhos e arquivados. Clique num dashboard para editar ou excluir; a bandeira troca o status e o olho abre a pré-visualização."
            : "Abra um para ver as tabelas que ele espera e adicione a uma organização."}
        </p>
      </div>
      <VitrineBrowser
        entries={admin ? adminEntries(admin.rows, admin.editId ?? null) : publicEntries(items)}
        action={admin ? <NewDashboardModal key="cadastrar" /> : undefined}
      />
    </section>
  );
}
