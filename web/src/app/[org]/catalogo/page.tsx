import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { Catalog } from "@/components/DashboardLists";
import { getClientContext, getOrgContext, orgActions, requireAction } from "@/lib/access";
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

  return (
    <OrgFrame org={ctx.org} isAdmin={orgActions(ctx).has("admin")} userName={ctx.user.name}>
      <PageHeader
        crumbs={[{ label: target, href: backHref }]}
        eyebrow="Catálogo"
        title={`Adicionar dashboard para ${target}`}
        subtitle="Cada dashboard declara as tabelas que espera. Depois de ativar, suba os arquivos e publique."
        actions={<Link href={backHref} className="btn btn-ghost">Voltar</Link>}
      />
      <Catalog templates={await listTemplates()} orgSlug={ctx.org.slug} clientSlug={client?.slug} targetLabel={target} />
    </OrgFrame>
  );
}
