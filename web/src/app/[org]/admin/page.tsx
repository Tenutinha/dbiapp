import type { Metadata } from "next";
import { Forbidden, OrgFrame } from "@/components/AppShell";
import { AdminSetupTable } from "@/components/admin/AdminSetupTable";
import { DataModal } from "@/components/admin/DataModal";
import { ThemeModal } from "@/components/admin/ThemeModal";
import { DataManager } from "@/components/data/DataManager";
import { getOrgContext, orgActions, requireAction, requireInstance, type InstanceAccess } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { buildSpaceGroups } from "@/lib/admin-setup";
import { toPickerItem } from "@/lib/catalog-picker";
import { listFilesInUse, listOrgDashboards } from "@/lib/data/instances";
import { listClients, listOrgPeople } from "@/lib/data/organizations";
import { guard } from "@/lib/guard";
import { listTemplates } from "@/lib/templates/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administração" };

/** ?dados=<id>: the dashboard whose data opens in the modal; an unknown or foreign id just shows no modal. */
async function loadDataModal(orgSlug: string, instanceId: string | undefined): Promise<InstanceAccess | null> {
  if (!instanceId) return null;
  try {
    return await requireInstance(instanceId, "manageData", orgSlug);
  } catch (err) {
    if (err instanceof AccessError) return null;
    throw err;
  }
}

async function loadAdmin(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "admin");
  const [clients, people, dashboards, templates, files] = await Promise.all([
    listClients(ctx.org.id),
    listOrgPeople(ctx.org.id),
    listOrgDashboards(ctx.org.id),
    listTemplates(),
    listFilesInUse(ctx.org.id),
  ]);
  const catalog = templates.map((t) => ({
    id: t.id,
    name: t.name,
    tables: t.tables.map((tb) => ({ name: tb.name, kind: tb.kind })),
  }));
  const groups = buildSpaceGroups(dashboards, clients, files, catalog);
  return { ctx, people, groups, pickerItems: templates.map(toPickerItem) };
}

/** /<org>/admin — only the configuration table (see docs/admin-organizacao.md). */
export default async function AdminPage({ params, searchParams }: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dados, tema } = await searchParams;
  const data = await guard(loadAdmin((await params).org));
  if (data === "forbidden") return <Forbidden message="Somente admins da organização acessam esta página." />;
  const { ctx, people, groups, pickerItems } = data;
  const modal = await loadDataModal(ctx.org.slug, typeof dados === "string" ? dados : undefined);

  return (
    <OrgFrame org={ctx.org} isAdmin userName={ctx.user.name}>
      <h1 className="sr-only">Configuração de {ctx.org.name}</h1>
      <AdminSetupTable
        org={{ slug: ctx.org.slug, name: ctx.org.name }}
        groups={groups}
        people={people}
        catalog={pickerItems}
      />
      {typeof tema === "string" && /^[a-z0-9-]{1,40}$/.test(tema) && (
        <ThemeModal
          orgSlug={ctx.org.slug}
          orgName={ctx.org.name}
          space={tema}
          spaces={groups.map((g) => ({ slug: g.slug, name: g.slug === null ? ctx.org.name : g.name }))}
        />
      )}
      {modal && (
        <DataModal
          closeHref={`/${ctx.org.slug}/admin`}
          title={modal.name}
          spaceName={modal.client?.name ?? ctx.org.name}
          dashboardHref={modal.activeVersionId ? `/${ctx.org.slug}/d/${modal.instanceId}` : null}
          pageHref={`/${ctx.org.slug}/d/${modal.instanceId}/dados`}
          tabs={(groups.find((g) => g.dashboards.some((d) => d.instanceId === modal.instanceId))?.dashboards ?? []).map((d) => ({
            href: `/${ctx.org.slug}/admin?dados=${d.instanceId}`,
            label: d.name,
            active: d.instanceId === modal.instanceId,
          }))}
        >
          <DataManager access={modal} />
        </DataModal>
      )}
    </OrgFrame>
  );
}
