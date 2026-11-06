import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import { TemplateJsonForm } from "@/components/admin/TemplateJsonForm";
import { getCurrentUser } from "@/lib/auth";
import { listCatalog } from "@/lib/data/catalog";
import { formatDateLong } from "@/lib/format";
import { guard } from "@/lib/guard";
import { ORIGIN_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/templates/labels";
import { catalogReady } from "@/lib/templates/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catálogo de dashboards" };

/** Admin master: every dashboard in the catalog, and the form to register new ones. */
export default async function PlatformCatalogPage() {
  const user = await guard(getCurrentUser());
  if (user === "forbidden" || !user.isPlatformAdmin) notFound();

  const ready = await catalogReady();
  const rows = ready ? await listCatalog() : [];

  return (
    <AppShell userName={user.name}>
      <PageHeader
        crumbs={[{ label: "Plataforma", href: "/plataforma" }]}
        eyebrow="Admin master"
        title="Catálogo de dashboards"
        subtitle="Dashboards prontos que as organizações podem ativar. Só os publicados aparecem para elas."
      />
      {!ready ? (
        <Notice tone="error">A tabela do catálogo ainda não existe neste banco. Aplique a migration 007_dashboard_catalog.sql.</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">Dashboard</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Em uso</th>
                  <th className="px-4 py-3 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-line/50 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/plataforma/catalogo/${t.id}`} className="font-medium hover:text-brand-2">{t.name}</Link>
                      <p className="text-xs text-muted">
                        {t.area} · {ORIGIN_LABEL[t.origin]} · v{t.version}
                        {t.builtIn && " · embutido"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.usage}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDateLong(t.updatedAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">Nenhum dashboard cadastrado ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <TemplateJsonForm mode="create" />
        </div>
      )}
    </AppShell>
  );
}
