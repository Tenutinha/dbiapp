import { Suspense } from "react";
import { requireInstance, type ClientRef, type InstanceAccess, type OrgRef } from "@/lib/access";
import { AccessError, type CurrentUser } from "@/lib/auth";
import { formatDateLong } from "@/lib/format";
import { firstItem, nextItem, previousItem, type TocGroup } from "@/lib/layout/toc";
import type { Membership } from "@/lib/permissions";
import { loadSpace } from "@/lib/services/space";
import { getTemplate } from "@/lib/templates/registry";
import { buildOutline, type SummaryItem } from "@/lib/templates/sections";
import { readViewSelection } from "@/lib/view-selection";
import { DashboardArrival } from "./DashboardArrival";
import { DashboardBody, DashboardFallback } from "./DashboardBody";
import { NextDashboard } from "./NextDashboard";
import type { Outlines } from "./SidebarNav";
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
 * Analyses of every dashboard in the summary, for the sidebar. A template that cannot be read only
 * leaves its dashboard without nested analyses; the page still opens.
 */
export async function loadOutlines(toc: readonly TocGroup[]): Promise<Outlines> {
  const items = toc.flatMap((g) => g.items);
  const templateIds = [...new Set(items.map((i) => i.templateId))];
  const loaded = await Promise.all(
    templateIds.map(async (id): Promise<[string, SummaryItem[]]> => {
      try {
        const template = await getTemplate(id);
        return [id, template ? buildOutline(template) : []];
      } catch (err) {
        console.error(`[space] could not read the summary of template ${id}`, err);
        return [id, []];
      }
    }),
  );
  const byTemplate = new Map(loaded);
  return Object.fromEntries(items.map((i) => [i.id, byTemplate.get(i.templateId) ?? []]));
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

  // Only what the frame of the page needs is awaited here; the data arrives inside the Suspense below.
  const [template, outlines] = await Promise.all([getTemplate(access.templateId), loadOutlines(space.toc)]);
  const anchorsKey = template ? buildOutline(template).map((i) => i.anchor).join("|") : "";
  const next = nextItem(space.toc, access.instanceId);
  const previous = previousItem(space.toc, access.instanceId);
  const shareLink = access.actions.has("share")
    ? [{ href: `/${org.slug}/d/${access.instanceId}/compartilhar`, label: "Compartilhar" }]
    : [];
  const header = (
    <MainHeader
      kicker={client ? `${org.name} · ${client.name}` : org.name}
      meta={`Atualizado em ${formatDateLong(access.publishedAt)}`}
      title={access.name}
      lead={access.description ?? template?.description}
      links={shareLink}
    />
  );

  return (
    <Workspace
      space={space}
      currentId={access.instanceId}
      userName={user.name}
      outlines={outlines}
    >
      <DashboardArrival dashboardId={access.instanceId} />
      {/* Keyed by dashboard: a new one fades in (dash-enter) instead of patching the previous page. */}
      <div key={access.instanceId} className="dash-enter">
        {/* A new dashboard opens at once as a skeleton; a filter change keeps the page and only its cards wait. */}
        <Suspense fallback={<DashboardFallback header={header} hasPrevious={previous !== null} />}>
          <DashboardBody
            instanceId={access.instanceId}
            templateId={access.templateId}
            activeVersionId={access.activeVersionId}
            searchParams={searchParams}
            anchorsKey={anchorsKey}
            before={
              <>
                {previous && <NextDashboard direction="previous" id={previous.id} name={previous.name} number={previous.number} />}
                {header}
              </>
            }
            after={next && <NextDashboard id={next.id} name={next.name} number={next.number} />}
          />
        </Suspense>
      </div>
    </Workspace>
  );
}
