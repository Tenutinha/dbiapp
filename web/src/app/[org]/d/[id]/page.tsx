import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Forbidden } from "@/components/AppShell";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { instanceLinks } from "@/components/workspace/instanceLinks";
import { MainHeader, Workspace } from "@/components/workspace/Workspace";
import { requireInstance } from "@/lib/access";
import { formatDateLong } from "@/lib/format";
import { guard } from "@/lib/guard";
import { loadDashboard } from "@/lib/services/dashboard";
import { loadSpace } from "@/lib/services/space";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

interface Props {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { org, id } = await params;
  const access = await guard(requireInstance(id, "view", org));
  if (access === "forbidden") return <Forbidden />;
  if (!access.activeVersionId) {
    if (access.actions.has("manageData")) redirect(`/${org}/d/${id}/dados`);
    return <Forbidden message="Este dashboard ainda não tem dados publicados." />;
  }

  const [space, dashboard] = await Promise.all([
    loadSpace(access.org, access.client, access.membership),
    loadDashboard(access.templateId, access.activeVersionId, await searchParams),
  ]);

  return (
    <Workspace space={space} currentId={id} userName={access.user.name}>
      <MainHeader
        kicker={access.client ? `${access.org.name} · ${access.client.name}` : access.org.name}
        meta={`Atualizado em ${formatDateLong(access.publishedAt)}`}
        title={access.name}
        lead={access.description ?? dashboard.template.description}
        links={instanceLinks(access, "dashboard")}
      />
      <DashboardView template={dashboard.template} data={dashboard.data} totalRows={dashboard.totalRows} />
    </Workspace>
  );
}
