import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { ThemeForm } from "@/components/admin/ThemeForm";
import { requireSpaceAction } from "@/lib/access";
import { getEffectiveBranding, getSpaceBranding } from "@/lib/data/branding";
import { listClients } from "@/lib/data/organizations";
import { guard } from "@/lib/guard";
import { DEFAULT_THEME } from "@/lib/theme/theme";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aparência" };

interface Props {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ espaco?: string }>;
}

async function load(orgSlug: string, clientSlug: string | null) {
  const access = await requireSpaceAction(orgSlug, clientSlug, "admin");
  const { orgId, clientId } = access.space;
  const [own, orgEffective, clients] = await Promise.all([
    getSpaceBranding(orgId, clientId),
    getEffectiveBranding(orgId, null),
    listClients(orgId),
  ]);
  return { access, own, orgEffective, clients };
}

export default async function AppearancePage({ params, searchParams }: Props) {
  const { org } = await params;
  const { espaco } = await searchParams;
  const clientSlug = typeof espaco === "string" && espaco ? espaco : null;
  const data = await guard(load(org, clientSlug));
  if (data === "forbidden") return <Forbidden message="Somente admins da organização personalizam a aparência." />;

  const { access, own, orgEffective, clients } = data;
  const { ctx, client } = access;
  const isClient = client !== null;
  const spaceName = client?.name ?? ctx.org.name;

  return (
    <OrgFrame org={ctx.org} isAdmin userName={ctx.user.name}>
      <PageHeader
        crumbs={[{ label: ctx.org.name, href: `/${org}` }, { label: "Administração", href: `/${org}/admin` }]}
        eyebrow="Aparência"
        title={`Tema de ${spaceName}`}
        subtitle={
          isClient
            ? `O que não for definido aqui segue o tema de ${ctx.org.name}.`
            : "Vale para a organização e para todos os clientes que não tiverem tema próprio."
        }
      />

      <nav aria-label="Espaço" className="mb-6 flex flex-wrap gap-2 text-sm">
        {[{ slug: null, name: ctx.org.name }, ...clients.map((c) => ({ slug: c.slug, name: c.name }))].map((s) => {
          const active = s.slug === clientSlug;
          return (
            <Link
              key={s.slug ?? "org"}
              href={`/${org}/admin/aparencia${s.slug ? `?espaco=${s.slug}` : ""}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${active ? "border-brand bg-brand/15 text-text" : "border-line text-muted hover:text-text"}`}
            >
              {s.name}
            </Link>
          );
        })}
      </nav>

      <ThemeForm
        key={clientSlug ?? "org"}
        orgSlug={org}
        clientSlug={clientSlug}
        spaceName={spaceName}
        input={own.input}
        inherited={isClient ? orgEffective.theme : DEFAULT_THEME}
        inheritedLabel={isClient ? ctx.org.name : "o padrão DBI"}
        logoUrl={own.logoUrl}
        inheritedLogoUrl={isClient ? orgEffective.logoUrl : null}
      />
    </OrgFrame>
  );
}
