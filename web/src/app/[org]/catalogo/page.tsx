import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { Catalog, type ActiveDashboard } from "@/components/DashboardLists";
import { getClientContext, getOrgContext, orgActions, requireAction } from "@/lib/access";
import { getSpaceLayout } from "@/lib/data/layout";
import { guard } from "@/lib/guard";
import { listTemplates } from "@/lib/templates/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catálogo" };

interface Props {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ para?: string }>;
}

/** Catalog of ready-made dashboards, activated for the organization or for `?para=<client>`. */
async function loadCatalog(orgSlug: string, clientSlug: string | undefined) {
  if (clientSlug) {
    const ctx = await getClientContext(orgSlug, clientSlug);
    requireAction(ctx.actions, "manageData");
    return { ctx, client: ctx.client };
  }
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "manageData");
  return { ctx, client: null };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { org } = await params;
  const { para } = await searchParams;
  const loaded = await guard(loadCatalog(org, typeof para === "string" ? para : undefined));
  if (loaded === "forbidden") return <Forbidden message="Só a equipe de dados da organização adiciona dashboards." />;

  const { ctx, client } = loaded;
  const backHref = `/${ctx.org.slug}${client ? `/${client.slug}` : ""}`;
  const target = client?.name ?? ctx.org.name;
  const [templates, layout] = await Promise.all([
    listTemplates(),
    getSpaceLayout({ orgId: ctx.org.id, clientId: client?.id ?? null }),
  ]);
  const active: Record<string, ActiveDashboard> = {};
  for (const d of layout.dashboards) active[d.templateId] ??= { id: d.id, published: d.published };

  return (
    <OrgFrame org={ctx.org} isAdmin={orgActions(ctx).has("admin")} userName={ctx.user.name}>
      <PageHeader
        crumbs={[{ label: target, href: backHref }]}
        eyebrow="Catálogo"
        title={`Adicionar dashboard para ${target}`}
        subtitle="Escolha os dashboards da sua ferramenta. Cada um declara as tabelas que espera: depois de ativar, suba os arquivos (CSV ou Parquet) e publique."
        actions={<Link href={backHref} className="btn btn-ghost">Voltar</Link>}
      />
      <Catalog templates={templates} orgSlug={ctx.org.slug} clientSlug={client?.slug} targetLabel={target} active={active} />
    </OrgFrame>
  );
}
