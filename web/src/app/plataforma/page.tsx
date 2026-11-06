import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/AppShell";
import { CreateOrgForm } from "@/components/admin/CreateOrgForm";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { listAllOrganizations } from "@/lib/data/platform";
import { formatDateLong } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plataforma" };

/** Admin master panel: every organization on the platform. Invisible (404) to everyone else. */
export default async function PlatformPage() {
  const user = await guard(getCurrentUser());
  if (user === "forbidden" || !user.isPlatformAdmin) notFound();
  const orgs = await listAllOrganizations();

  return (
    <AppShell userName={user.name}>
      <PageHeader
        eyebrow="Admin master"
        title="Plataforma DBI"
        subtitle="Todas as organizações. Como admin da plataforma, você entra em qualquer uma com acesso total."
        actions={<Link href="/plataforma/catalogo" className="btn btn-primary">Catálogo de dashboards</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Organização</th>
                <th className="px-4 py-3 text-right font-medium">Clientes</th>
                <th className="px-4 py-3 text-right font-medium">Dashboards</th>
                <th className="px-4 py-3 text-right font-medium">Pessoas</th>
                <th className="px-4 py-3 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/${o.slug}`} className="font-medium hover:text-brand-2">{o.name}</Link>
                    <p className="font-mono text-xs text-muted">/{o.slug}</p>
                    <Link href={`/${o.slug}/admin`} className="text-xs text-muted hover:text-text">Administração →</Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.clients}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.dashboards}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.people}</td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDateLong(o.createdAt)}</td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Nenhuma organização ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <CreateOrgForm />
      </div>
    </AppShell>
  );
}
