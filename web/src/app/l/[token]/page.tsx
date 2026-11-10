import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DashboardArrival } from "@/components/workspace/DashboardArrival";
import { NextDashboard } from "@/components/workspace/NextDashboard";
import { SidebarNav } from "@/components/workspace/SidebarNav";
import { DbiLogo, SidebarShell } from "@/components/workspace/SidebarShell";
import { ThemeScope } from "@/components/workspace/ThemeScope";
import { loadOutlines } from "@/components/workspace/SpaceHome";
import { MainHeader } from "@/components/workspace/Workspace";
import { getEffectiveBranding } from "@/lib/data/branding";
import { getSpaceLayout } from "@/lib/data/layout";
import { getPublishedDashboard, resolveSpaceLink } from "@/lib/data/space-links";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { buildToc, nextItem, previousItem } from "@/lib/layout/toc";
import { loadDashboard } from "@/lib/services/dashboard";
import { chooseDashboard, DASHBOARD_PARAM, spaceLinkPath } from "@/lib/space-link";
import { buildOutline } from "@/lib/templates/sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards compartilhados", robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A whole space opened by its public link (/l/<token>): the space's published dashboards, read-only,
 * without an account — the same screen a reader sees, minus everything that needs one (data area,
 * administration, other spaces, the user's menu). Unknown, revoked or expired links are a 404.
 */
export default async function PublicSpacePage({ params, searchParams }: Props) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const link = await resolveSpaceLink(token);
  if (!link) notFound();

  const query = await searchParams;
  const requested = typeof query[DASHBOARD_PARAM] === "string" ? query[DASHBOARD_PARAM] : undefined;
  // Everything else in the address is the open dashboard's filters.
  const filters = Object.fromEntries(Object.entries(query).filter(([k]) => k !== DASHBOARD_PARAM));

  const [layout, branding] = await Promise.all([
    getSpaceLayout({ orgId: link.orgId, clientId: link.clientId }),
    getEffectiveBranding(link.orgId, link.clientId),
  ]);
  const toc = buildToc(layout.sections, layout.dashboards, { includeUnpublished: false, includeEmptySections: false });
  const chosenId = chooseDashboard(toc.flatMap((g) => g.items.map((i) => i.id)), requested);
  const chosen = chosenId ? await getPublishedDashboard(link.orgId, link.clientId, chosenId) : null;
  const [dashboard, outlines] = await Promise.all([
    chosen ? loadDashboard(chosen.instanceId, chosen.templateId, chosen.activeVersionId, filters) : null,
    loadOutlines(toc),
  ]);
  const next = chosen ? nextItem(toc, chosen.instanceId) : null;
  const previous = chosen ? previousItem(toc, chosen.instanceId) : null;

  const home = spaceLinkPath(token);
  const hrefFor = (id: string): string => `${home}?${DASHBOARD_PARAM}=${id}`;
  const spaceName = link.clientName ?? link.orgName;
  const footer = (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">
        Somente leitura{link.expiresAt ? ` · link válido até ${formatDateTime(link.expiresAt)}` : ""}
      </p>
      <Link href="/" aria-label="DBI" title="DBI" className="w-fit rounded-md hover:opacity-80">
        <DbiLogo />
      </Link>
    </div>
  );

  return (
    <ThemeScope theme={branding.theme}>
      <SidebarShell
        title={spaceName}
        org={{ name: link.orgName, href: null }}
        spaces={link.clientName ? [{ href: home, label: link.clientName, kind: "client", current: true }] : []}
        logoUrl={branding.logoUrl}
        orgSlug={link.orgSlug}
        clientSlug={link.clientSlug}
        homeHref={home}
        footer={footer}
        content={
          <div className="mx-auto max-w-[1180px]">
            {chosen && dashboard ? (
              <>
                <DashboardArrival dashboardId={chosen.instanceId} anchorsKey={buildOutline(dashboard.template).map((i) => i.anchor).join("|")} />
                <div key={chosen.instanceId} className="dash-enter">
                  {previous && (
                    <NextDashboard direction="previous" id={previous.id} name={previous.name} number={previous.number} href={hrefFor(previous.id)} />
                  )}
                  <MainHeader
                    kicker={link.clientName ? `${link.orgName} · ${link.clientName}` : link.orgName}
                    meta={chosen.publishedAt ? `Atualizado em ${formatDateLong(chosen.publishedAt)}` : undefined}
                    title={chosen.name}
                    lead={chosen.description ?? dashboard.template.description}
                  />
                  <DashboardView template={dashboard.template} data={dashboard.data} totalRows={dashboard.totalRows} />
                  {next && <NextDashboard id={next.id} name={next.name} number={next.number} href={hrefFor(next.id)} />}
                </div>
              </>
            ) : (
              <p className="py-24 text-center text-muted">Ainda não há dashboards publicados em {spaceName}.</p>
            )}
          </div>
        }
      >
        <SidebarNav toc={toc} currentId={chosen?.instanceId ?? null} outlines={outlines} hrefFor={hrefFor} />
      </SidebarShell>
    </ThemeScope>
  );
}
