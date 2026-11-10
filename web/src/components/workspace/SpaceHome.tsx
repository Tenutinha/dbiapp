import { DashboardView } from "@/components/dashboard/DashboardView";
import { requireInstance, type ClientRef, type InstanceAccess, type OrgRef } from "@/lib/access";
import { AccessError, type CurrentUser } from "@/lib/auth";
import { formatDateLong } from "@/lib/format";
import { firstItem } from "@/lib/layout/toc";
import type { Membership } from "@/lib/permissions";
import { loadDashboard } from "@/lib/services/dashboard";
import { loadSpace } from "@/lib/services/space";
import { buildOutline } from "@/lib/templates/sections";
import { readViewSelection } from "@/lib/view-selection";
import { MainHeader, Workspace } from "./Workspace";

type SearchParams = Record<string, string | string[] | undefined>;

interface SpaceHomeProps {
  org: OrgRef;
  client: ClientRef | null;
  membership: Membership;
  user: CurrentUser;
  /** Dashboard filters (the only thing that ever follows the space's address). */
  searchParams: SearchParams;
}

/** A published dashboard of exactly this space that the user may view; null otherwise. */
async function openable(instanceId: string, org: OrgRef, client: ClientRef | null): Promise<InstanceAccess | null> {
  try {
    const access = await requireInstance(instanceId, "view", org.slug);
    const sameSpace = (access.client?.id ?? null) === (client?.id ?? null);
    return sameSpace && access.activeVersionId ? access : null;
  } catch (err) {
    if (err instanceof AccessError && err.status !== 401) return null;
    throw err;
  }
}

/**
 * The viewing screen of a space, always on its own address (`/<org>` or `/<org>/<client>`):
 * the dashboard last opened here, else the first one of the summary. Only dashboards — no data
 * setup (that lives in the administration). Nothing published yet: an empty screen.
 */
export async function SpaceHome({ org, client, membership, user, searchParams }: SpaceHomeProps) {
  const chosenId = await readViewSelection(client?.id ?? org.id);
  const [space, chosen] = await Promise.all([
    loadSpace(org, client, membership),
    chosenId ? openable(chosenId, org, client) : Promise.resolve(null),
  ]);

  const first = firstItem(space.toc);
  const access = chosen ?? (first ? await openable(first.id, org, client) : null);
  if (!access?.activeVersionId) {
    return <Workspace space={space} currentId={null} userName={user.name}>{null}</Workspace>;
  }

  const dashboard = await loadDashboard(access.instanceId, access.templateId, access.activeVersionId, searchParams);
  const shareLink = access.actions.has("share")
    ? [{ href: `/${org.slug}/d/${access.instanceId}/compartilhar`, label: "Compartilhar" }]
    : [];

  return (
    <Workspace
      space={space}
      currentId={access.instanceId}
      userName={user.name}
      outline={buildOutline(dashboard.template)}
    >
      <MainHeader
        kicker={client ? `${org.name} · ${client.name}` : org.name}
        meta={`Atualizado em ${formatDateLong(access.publishedAt)}`}
        title={access.name}
        lead={access.description ?? dashboard.template.description}
        links={shareLink}
      />
      <DashboardView template={dashboard.template} data={dashboard.data} totalRows={dashboard.totalRows} />
    </Workspace>
  );
}
